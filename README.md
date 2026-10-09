# YouTube Watch Party System

A real-time YouTube watch party application that allows multiple users to join a shared room and watch videos together with synchronized playback.

## Features

* Create and join rooms using unique room codes.
* Synchronize video playback, including play, pause, and seek.
* Integrate YouTube videos using the YouTube IFrame Player API.
* Communicate in real time using Socket.IO.
* Support host, moderator, and participant roles.
* Allow authorized users to manage participant roles and remove participants.
* Responsive interface for desktop, tablet, and mobile screens.

## Tech Stack

### Frontend

* React
* TypeScript
* Vite
* Socket.IO Client
* YouTube Player integration

### Backend

* Node.js
* Express
* TypeScript
* Socket.IO
* In-memory room and playback state

## Project Structure

```text
watch-party/
├── client/    # React frontend
├── server/    # Express and Socket.IO backend
├── .gitignore
└── README.md
```

## Prerequisites

* Node.js and npm
* Git

## Local Setup

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd youtube-watch-party
```

### 2. Start the backend

```bash
cd server
npm install
```

Create a `.env` file in the `server` directory:

```env
PORT=4000
CLIENT_URL=http://localhost:5173
```

Start the backend:

```bash
npm run dev
```

### 3. Start the frontend

Open a second terminal:

```bash
cd client
npm install
npm run dev
```

Open the local URL displayed by Vite in your browser.

## Notes

* Room and playback information are stored in server memory and are not permanently persisted.
* The frontend and backend must both be running for real-time functionality.
* Production deployment requires configuring the public backend URL and allowed frontend origin.

## Deployment

Deployment links will be added after the frontend and backend are published.

## License

Add a license if you intend to distribute the project under specific reuse terms.
