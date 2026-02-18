# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PongPongPong is a real-time multiplayer Pong game supporting up to 4 players. Fully browser-based using WebRTC peer-to-peer connections via PeerJS. One browser acts as the host (running all game logic), other players join by scanning a QR code or opening a join URL. No server required — all game traffic is direct between browsers.

## Commands

No build step, server, or install required. Open `public/index.html` in a browser to play.

Deployed automatically to GitHub Pages via `.github/workflows/publish.yml` on push to `master`.

## Architecture

**All logic lives in static files under `public/`:**

- **public/game.js** — The entire game engine. Handles role detection (host vs joiner via `?join=PEER_ID` URL param), PeerJS connection setup, and the host-side game loop: state machine (`lobby` → `playing` → `ended`), 60 FPS physics, ball collision, scoring (first to 10 wins), paddle movement, and player assignment to sides (top/bottom/left/right). Joiners are pure renderers that send paddle input and receive state. Also handles QR code generation, touch controls for mobile, and disconnect handling.
- **public/index.html** — Three screen sections toggled by game status: lobby (name entry + player list + QR code), game (canvas + scoreboard + touch controls), and end screen (winner + final scores). Loads PeerJS and QRCode.js from CDN.
- **public/style.css** — UI styling with mobile responsive breakpoint at 850px. Includes styles for QR code section, touch control buttons, and connection status indicator.

**Message protocol:** JSON messages with `type` field (`joinGame`, `startGame`, `paddleMove`, `returnToLobby`, `gameState`, `playerAssigned`, `gameFull`) sent via WebRTC DataChannel — host broadcasts `gameState` to all joiners at 60 FPS.

**Host model:** The first browser to open the page (no `?join=` param) is the host. The host runs game logic locally and adds itself as a player without network round-trips. No host migration — if the host disconnects, the game ends.

## Dependencies

No npm dependencies. Two CDN-loaded libraries:
- **PeerJS** (1.5.4) — wraps WebRTC, provides free cloud signaling server for initial handshake
- **QRCode.js** (1.5.4) — generates QR codes client-side for the join URL
