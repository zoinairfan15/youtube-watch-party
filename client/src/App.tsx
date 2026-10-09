
import { useEffect, useRef, useState } from "react";
import YouTube from "react-youtube";
import { io } from "socket.io-client";
import "./App.css";

const socket = io(
  import.meta.env.VITE_SERVER_URL || "http://localhost:4000"
);

type Role = "host" | "moderator" | "participant";
type PlaybackStatus = "playing" | "paused";

interface Participant {
  id: string;
  username: string;
  role: Role;
}

interface PlaybackState {
  videoId: string | null;
  status: PlaybackStatus;
  currentTime: number;
}

interface PlayerApi {
  getCurrentTime(): number;
  cueVideoById(videoId: string, startSeconds?: number): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
}

function getVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    let id: string | null = null;

    if (parsed.hostname === "youtu.be") {
      id = parsed.pathname.slice(1).split("/")[0] ?? null;
    } else if (
      ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
        parsed.hostname
      )
    ) {
      if (parsed.pathname === "/watch") {
        id = parsed.searchParams.get("v");
      } else {
        id =
          parsed.pathname.match(/^\/(embed|shorts)\/([^/]+)/)?.[2] ??
          null;
      }
    }

    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function App() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [message, setMessage] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [seekTime, setSeekTime] = useState("0");
  const [playerReady, setPlayerReady] = useState(false);
  const [connection, setConnection] = useState(socket.connected);

  const playerRef = useRef<PlayerApi | null>(null);
  const playbackRef = useRef<PlaybackState>({
    videoId: null,
    status: "paused",
    currentTime: 0,
  });

  const canControl = myRole === "host" || myRole === "moderator";

  useEffect(() => {
    const connected = () => setConnection(true);
    const disconnected = () => setConnection(false);

    socket.on("connect", connected);
    socket.on("disconnect", disconnected);

    const handleRoomCreated = (data: { roomId: string }) => {
      setRoomId(data.roomId);
      socket.emit("join_room", {
        roomId: data.roomId,
        username: username.trim(),
      });
    };

    const handleRoomJoined = (data: {
      roomId: string;
      participant: Participant;
      participants: Participant[];
    }) => {
      setRoomId(data.roomId);
      setMyRole(data.participant.role);
      setParticipants(data.participants);
      setJoinedRoom(true);
      setMessage("");
    };

    const handleRoomError = (data: { message: string }) => {
      setMessage(data.message);
    };

    const handleUserJoined = (data: { participant: Participant }) => {
      setParticipants((current) =>
        current.some((p) => p.id === data.participant.id)
          ? current
          : [...current, data.participant]
      );
    };

    const handleUserLeft = (data: { participantId: string }) => {
      setParticipants((current) =>
        current.filter((p) => p.id !== data.participantId)
      );
    };

    const handleSyncState = (state: PlaybackState) => {
      playbackRef.current = state;

      if (state.videoId) {
        setVideoUrl(
          `https://www.youtube.com/watch?v=${state.videoId}`
        );
      }
    };

    const handleParticipantsUpdated = (
      updated: Participant[]
    ) => {
      setParticipants(updated);
      const me = updated.find((p) => p.id === socket.id);
      if (me) setMyRole(me.role);
    };

    const handlePlaybackUpdate = (state: PlaybackState) => {
      const previousVideoId = playbackRef.current.videoId;
      playbackRef.current = state;

      if (state.videoId) {
        setVideoUrl(
          `https://www.youtube.com/watch?v=${state.videoId}`
        );
      }

      const player = playerRef.current;
      if (!player || !state.videoId) return;

      if (previousVideoId !== state.videoId) {
        player.cueVideoById(state.videoId, state.currentTime);

        if (state.status === "playing") {
          player.playVideo();
        }
        return;
      }

      if (
        Math.abs(player.getCurrentTime() - state.currentTime) > 1.5
      ) {
        player.seekTo(state.currentTime, true);
      }

      if (state.status === "playing") {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    };

    const handleParticipantRemoved = (data: { message: string }) => {
      setMessage(data.message);
      setJoinedRoom(false);
      setMyRole(null);
      setParticipants([]);
      setRoomId("");
      playbackRef.current = {
        videoId: null,
        status: "paused",
        currentTime: 0,
      };
      setVideoUrl("");
    };

    socket.on("room_created", handleRoomCreated);
    socket.on("room_joined", handleRoomJoined);
    socket.on("room_error", handleRoomError);
    socket.on("user_joined", handleUserJoined);
    socket.on("user_left", handleUserLeft);
    socket.on("sync_state", handleSyncState);
    socket.on("playback_update", handlePlaybackUpdate);
    socket.on("participants_updated", handleParticipantsUpdated);
    socket.on("participant_removed", handleParticipantRemoved);

    return () => {
      socket.off("connect", connected);
      socket.off("disconnect", disconnected);
      socket.off("room_created", handleRoomCreated);
      socket.off("room_joined", handleRoomJoined);
      socket.off("room_error", handleRoomError);
      socket.off("user_joined", handleUserJoined);
      socket.off("user_left", handleUserLeft);
      socket.off("sync_state", handleSyncState);
      socket.off("playback_update", handlePlaybackUpdate);
      socket.off("participants_updated", handleParticipantsUpdated);
      socket.off("participant_removed", handleParticipantRemoved);
    };
  }, [username]);

  useEffect(() => {
    if (!joinedRoom || !canControl || !playerReady) return;

    const intervalId = window.setInterval(() => {
      const player = playerRef.current;

      if (player && playbackRef.current.status === "playing") {
        socket.emit("sync_tick", {
          currentTime: player.getCurrentTime(),
        });
      }
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [joinedRoom, canControl, playerReady]);

  const createRoom = () => {
    if (!username.trim()) {
      setMessage("Enter your name to get started.");
      return;
    }

    if (!socket.connected) {
      setMessage("Connecting to the server. Please try again.");
      return;
    }

    setMessage("");
    socket.emit("create_room");
  };

  const joinRoom = () => {
    if (!username.trim() || !roomId.trim()) {
      setMessage("Enter both your name and the room code.");
      return;
    }

    if (!socket.connected) {
      setMessage("Not connected to the server. Please try again.");
      return;
    }

    setMessage("");
    socket.emit("join_room", {
      roomId: roomId.trim().toUpperCase(),
      username: username.trim(),
    });
  };

  const changeVideo = () => {
    if (!canControl) return;

    const videoId = getVideoId(videoUrl);

    if (!videoId) {
      setMessage("Please paste a valid YouTube video URL.");
      return;
    }

    playbackRef.current = {
      videoId,
      status: "paused",
      currentTime: 0,
    };

    setVideoUrl(`https://www.youtube.com/watch?v=${videoId}`);
    setPlayerReady(false);
    setMessage("");
    socket.emit("change_video", { videoId });
  };

  const handlePlayerReady = (event: { target: unknown }) => {
    const player = event.target as PlayerApi;
    playerRef.current = player;
    setPlayerReady(true);

    const state = playbackRef.current;

    if (state.videoId) {
      player.cueVideoById(state.videoId, state.currentTime);

      if (state.status === "playing") {
        player.playVideo();
      }
    }
  };

  const handlePlayerStateChange = (event: {
    data: number;
    target: unknown;
  }) => {
    const player = event.target as PlayerApi;
    if (!canControl) return;

    if (event.data === 1 || event.data === 2) {
      const currentTime = player.getCurrentTime();
      const status = event.data === 1 ? "playing" : "paused";

      playbackRef.current = {
        ...playbackRef.current,
        status,
        currentTime,
      };

      socket.emit(status === "playing" ? "play" : "pause", {
        currentTime,
      });
    }
  };

  const playVideo = () => {
    const player = playerRef.current;

    if (!canControl || !player || !playbackRef.current.videoId) {
      return;
    }

    const currentTime = player.getCurrentTime();

    playbackRef.current = {
      ...playbackRef.current,
      status: "playing",
      currentTime,
    };

    socket.emit("play", { currentTime });
    player.playVideo();
  };

  const pauseVideo = () => {
    const player = playerRef.current;

    if (!canControl || !player || !playbackRef.current.videoId) {
      return;
    }

    const currentTime = player.getCurrentTime();

    playbackRef.current = {
      ...playbackRef.current,
      status: "paused",
      currentTime,
    };

    socket.emit("pause", { currentTime });
    player.pauseVideo();
  };

  const seekVideo = () => {
    const player = playerRef.current;
    const seconds = Number(seekTime);

    if (
      !canControl ||
      !player ||
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      return;
    }

    player.seekTo(seconds, true);

    playbackRef.current = {
      ...playbackRef.current,
      currentTime: seconds,
    };

    socket.emit("seek", { currentTime: seconds });
  };

  const copyRoom = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setMessage("Room code copied! Send it to your friends.");
    } catch {
      setMessage(`Share this room code: ${roomId}`);
    }
  };

  if (!joinedRoom) {
    return (
      <main className="app-shell landing-shell">
        <nav className="topbar">
          <a className="brand" href="#top">
            <span className="brand-mark">▶</span>
            <span>
              gather<span className="brand-dot">.</span>
            </span>
          </a>

          <div className="topbar-right">
            <span
              className={`status-dot ${connection ? "online" : "offline"}`}
            />
            {connection ? "Server connected" : "Connecting to server"}
          </div>
        </nav>

        <section className="landing-grid" id="top">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-line" />
              YOUR PEOPLE. YOUR VIDEOS.
            </div>

            <h1>
              Watch together.
              <br />
              <span>Feel closer.</span>
            </h1>

            <p className="hero-description">
              Your own little corner of the internet to watch, laugh,
              and hang out — in perfect sync, wherever everyone is.
            </p>

            <div className="feature-row">
              <div className="feature-icon">↗</div>
              <div>
                <strong>In sync, always</strong>
                <small>Playback follows the whole room</small>
              </div>

              <div className="feature-icon">✦</div>
              <div>
                <strong>Made for your crew</strong>
                <small>Private rooms, shared moments</small>
              </div>
            </div>

            <div className="hero-art" aria-hidden="true">
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <div className="art-glow" />
              <div className="art-play">▶</div>

              <div className="floating-card card-one">
                <span className="mini-avatar avatar-pink">J</span>
                <span>
                  <b>Jamie</b>
                  <small>is watching</small>
                </span>
                <span className="sound-bars">▂▅▃</span>
              </div>

              <div className="floating-card card-two">
                <span className="mini-avatar avatar-blue">A</span>
                <span>
                  <b>Alex</b>
                  <small>joined the party</small>
                </span>
                <span className="sparkle">✦</span>
              </div>

              <div className="art-caption">
                SAME SCREEN ENERGY <span>✦</span>
              </div>
            </div>
          </div>

          <div className="entry-card">
            <div className="card-kicker">LET'S GET THE CREW TOGETHER</div>
            <h2>
              Your next watch party
              <br />
              starts here.
            </h2>
            <p className="card-subtitle">
              A name is all you need to get started.
            </p>

            <label htmlFor="username">YOUR NAME</label>
            <input
              className="text-input"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. movie night legend"
              maxLength={28}
            />

            <button className="primary-button" onClick={createRoom}>
              Create a room <span>↗</span>
            </button>

            <div className="or-divider">
              <span />
              <em>OR JOIN YOUR FRIENDS</em>
              <span />
            </div>

            <label htmlFor="roomId">ROOM CODE</label>
            <input
              className="text-input code-input"
              id="roomId"
              value={roomId}
              onChange={(e) =>
                setRoomId(e.target.value.toUpperCase().slice(0, 6))
              }
              placeholder="ENTER 6-LETTER CODE"
              maxLength={6}
            />

            <button className="secondary-button" onClick={joinRoom}>
              Join a room <span>→</span>
            </button>

            {message && (
              <p className="feedback" role="alert">
                {message}
              </p>
            )}

            <div className="privacy-note">
              <span>✦</span> No account needed. Just bring your people.
            </div>
          </div>
        </section>

        <footer className="landing-footer">
          <span>
            gather<span className="brand-dot">.</span>{" "}
            <small>GOOD VIDEOS ARE BETTER TOGETHER.</small>
          </span>
          <span>
            MADE FOR THE MOMENTS IN BETWEEN <b>✳</b>
          </span>
        </footer>
      </main>
    );
  }

  return (
    <main className="app-shell room-shell">
      <nav className="topbar room-topbar">
        <a className="brand" href="#top">
          <span className="brand-mark">▶</span>
          <span>
            gather<span className="brand-dot">.</span>
          </span>
        </a>

        <div className="room-topbar-center">
          <span className="live-pill">
            <i /> LIVE ROOM
          </span>
          <span className="topbar-roomcode">ROOM / {roomId}</span>
        </div>

        <div className="topbar-right">
          <span
            className={`status-dot ${connection ? "online" : "offline"}`}
          />
          {connection ? "Connected" : "Reconnecting"}
        </div>
      </nav>

      <section className="room-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" />
            YOUR PRIVATE HANGOUT
          </div>
          <h1>
            It's better <span>together.</span>
          </h1>
          <p>Hey {username}, your people are right here. Get comfy.</p>
        </div>

        <div className="invite-box">
          <div>
            <small>YOUR ROOM CODE</small>
            <strong>{roomId}</strong>
          </div>
          <button onClick={copyRoom} className="copy-button">
            ▣ <span>Copy invite</span>
          </button>
        </div>
      </section>

      <section className="room-layout">
        <div className="watch-column">
          <div className="section-label">
            <span className="label-dot" />
            NOW WATCHING
            <span className="label-rule" />
          </div>

          <div className="video-frame">
            {playbackRef.current.videoId ? (
              <YouTube
                key={playbackRef.current.videoId}
                videoId={playbackRef.current.videoId}
                onReady={handlePlayerReady}
                onStateChange={handlePlayerStateChange}
                opts={{
                  width: "100%",
                  height: "100%",
                  playerVars: {
                    autoplay: 0,
                    controls: canControl ? 1 : 0,
                    rel: 0,
                  },
                }}
              />
            ) : (
              <div className="empty-player">
                <div className="empty-play">▶</div>
                <h3>The screen is all yours.</h3>
                <p>
                  {canControl
                    ? "Drop in a YouTube link below and let the good times roll."
                    : "The host is picking something good. Hang tight."}
                </p>
                <span className="waiting-pill">
                  <i /> WAITING FOR VIDEO
                </span>
              </div>
            )}
          </div>

          {canControl && (
            <div className="video-loader">
              <div className="loader-label">
                <span className="loader-icon">↗</span>
                <div>
                  <strong>Change what's on</strong>
                  <small>Paste any YouTube video link</small>
                </div>
              </div>

              <div className="loader-input-row">
                <input
                  className="text-input"
                  aria-label="YouTube video URL"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") changeVideo();
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
                <button
                  className="primary-button load-button"
                  onClick={changeVideo}
                >
                  Load video <span>↗</span>
                </button>
              </div>
            </div>
          )}

          <div className="playback-panel">
            <div className="playback-title">
              <span className="control-symbol">♫</span>
              <div>
                <strong>Playback controls</strong>
                <small>
                  {canControl
                    ? "You're in control of the room"
                    : "Sit back and enjoy the show"}
                </small>
              </div>
            </div>

            {canControl ? (
              <div className="playback-actions">
                <button
                  className="control-button play-control"
                  disabled={!playerReady || !playbackRef.current.videoId}
                  onClick={playVideo}
                >
                  ▶ Play
                </button>

                <button
                  className="control-button"
                  disabled={!playerReady || !playbackRef.current.videoId}
                  onClick={pauseVideo}
                >
                  Ⅱ Pause
                </button>

                <div className="seek-group">
                  <input
                    aria-label="Seek position in seconds"
                    type="number"
                    min="0"
                    value={seekTime}
                    onChange={(e) => setSeekTime(e.target.value)}
                  />
                  <button
                    className="control-button"
                    disabled={!playerReady || !playbackRef.current.videoId}
                    onClick={seekVideo}
                  >
                    Seek ↗
                  </button>
                </div>
              </div>
            ) : (
              <span className="viewer-pill">◉ VIEWING MODE</span>
            )}
          </div>

          {message && (
            <p className="feedback room-feedback" role="alert">
              {message}
            </p>
          )}
        </div>

        <aside className="people-card">
          <div className="people-card-heading">
            <div>
              <div className="section-label">
                <span className="label-dot" />
                THE CREW
              </div>
              <h2>
                Room people{" "}
                <span className="count-badge">{participants.length}</span>
              </h2>
            </div>
            <div className="people-icon">♧</div>
          </div>

          <p className="people-intro">
            Good company makes a good watch party.
          </p>

          <div className="people-list">
            {participants.map((p, i) => (
              <div className="person-row" key={p.id}>
                <div className={`person-avatar avatar-color-${i % 5}`}>
                  {p.username.trim().charAt(0).toUpperCase() || "?"}
                  {p.role === "host" && (
                    <span className="host-crown">✦</span>
                  )}
                </div>

                <div className="person-info">
                  <strong>
                    {p.username}
                    {p.id === socket.id && <em> YOU</em>}
                  </strong>
                  <span>
                    {p.id === socket.id
                      ? "That's you"
                      : p.role === "host"
                        ? "Started this party"
                        : p.role === "moderator"
                          ? "Helping run the room"
                          : "Here for the vibes"}
                  </span>
                </div>

                <span className={`role-pill role-${p.role}`}>
                  {p.role}
                </span>

                {myRole === "host" &&
                  p.id !== socket.id &&
                  p.role !== "host" && (
                    <div className="person-actions">
                      {p.role === "participant" && (
                        <button
                          title="Promote to moderator"
                          aria-label={`Promote ${p.username} to moderator`}
                          onClick={() =>
                            socket.emit("assign_role", {
                              participantId: p.id,
                              role: "moderator",
                            })
                          }
                        >
                          ↑
                        </button>
                      )}
                      <button
                        className="remove-action"
                        title="Remove participant"
                        aria-label={`Remove ${p.username}`}
                        onClick={() =>
                          socket.emit("remove_participant", {
                            participantId: p.id,
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  )}
              </div>
            ))}
          </div>

          <button className="invite-wide-button" onClick={copyRoom}>
            <span>＋</span> Invite someone new <b>↗</b>
          </button>

          <div className="room-tip">
            <span>✦</span>
            <div>
              <strong>A little room etiquette</strong>
              <p>
                Hosts and moderators steer the video. Everyone else brings
                the vibes.
              </p>
            </div>
          </div>

          <div className="role-legend">
            <span><i className="legend-host" /> Host</span>
            <span><i className="legend-mod" /> Moderator</span>
            <span><i className="legend-viewer" /> Participant</span>
          </div>
        </aside>
      </section>

      <footer className="room-footer">
        <span>
          gather<span className="brand-dot">.</span>{" "}
          <small>GOOD VIDEOS ARE BETTER TOGETHER.</small>
        </span>
        <span>
          ROOM {roomId} <b>✳</b>
        </span>
      </footer>
    </main>
  );
}

export default App;