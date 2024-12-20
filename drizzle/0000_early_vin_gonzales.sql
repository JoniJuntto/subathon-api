CREATE TABLE "events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event" varchar(255) NOT NULL,
	"time" timestamp DEFAULT now() NOT NULL,
	"user" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subathon_config" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subathon_config_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"maxEndTime" integer NOT NULL,
	"maxSleepTimeNight" integer NOT NULL,
	"maxSleepTimeDay" integer NOT NULL,
	"goals" json NOT NULL,
	"points" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subathon_state" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subathon_state_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"isActive" boolean DEFAULT false NOT NULL,
	"startTimeUnix" integer,
	"endTimeUnix" integer,
	"timeRemaining" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
