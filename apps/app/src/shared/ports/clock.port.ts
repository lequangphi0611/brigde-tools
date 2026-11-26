/** Port: thời gian. Mọi logic phụ thuộc thời gian (pausedUntil, lastSeen) đi qua đây để test điều khiển được. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
