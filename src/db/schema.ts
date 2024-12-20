import {
  integer,
  pgTable,
  varchar,
  timestamp,
  boolean,
  json,
} from "drizzle-orm/pg-core";

export const eventsTable = pgTable("events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  event: varchar({ length: 255 }).notNull(),
  time: timestamp().notNull().defaultNow(),
  user: varchar({ length: 255 }).notNull(),
});

export const subathonConfigTable = pgTable("subathon_config", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  maxEndTime: integer().notNull(),
  maxSleepTimeNight: integer().notNull(), // in seconds
  maxSleepTimeDay: integer().notNull(), // in seconds
  goals: json().notNull(), // Store goals as JSON
  points: integer().notNull().default(0),
});

export const subathonStateTable = pgTable("subathon_state", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  isActive: boolean().notNull().default(false),
  startTimeUnix: integer(),
  endTimeUnix: integer(),
  timeRemaining: integer().notNull().default(0),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});
