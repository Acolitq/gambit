// Central server configuration, overridable via environment variables.
export const config = {
  port: process.env.PORT ? Number(process.env.PORT) : 3000,

  // Starting time on each player's clock, in milliseconds (5 minutes).
  initialClockMs: 5 * 60 * 1000,

  // How long an opponent has to reconnect before they forfeit, in milliseconds.
  disconnectGraceMs: 30 * 1000,

  // Heartbeat interval for detecting dead sockets, in milliseconds.
  heartbeatMs: 25 * 1000,
};
