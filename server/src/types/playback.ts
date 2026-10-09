
export type PlaybackStatus = "playing" | "paused";

export interface PlaybackState {
  videoId: string | null;
  status: PlaybackStatus;
  currentTime: number;
}

export const createInitialPlaybackState = (): PlaybackState => ({
  videoId: null,
  status: "paused",
  currentTime: 0,
});