import * as dotenv from "dotenv";
import { RefreshingAuthProvider } from "@twurple/auth";
import * as fs from "fs";
import { ApiClient } from "@twurple/api";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { Server, Socket } from "socket.io";
import express, { Application } from "express";
import cors from "cors";
import http from "http";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  eventsTable,
  subathonConfigTable,
  subathonStateTable,
} from "./db/schema";
import { eq } from "drizzle-orm";

dotenv.config();

const app: Application = express();
const port = process.env.PORT || 8000;

app.use(express.json());

type Event = {
  event: string;
  time: Date;
  user: string;
};

const clientId = process.env.clientId;
const clientSecret = process.env.clientSecret;
const userId = process.env.userId;

const corsOptions = {
  origin: [
    "http://localhost:5174",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost:3000",
    "https://subathon-clock.onrender.com",
    "https://subathon-lander.onrender.com",
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 60000,
});

app.use(cors(corsOptions));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

const getSubathonState = async () => {
  const state = await db.select().from(subathonStateTable).limit(1);
  return state[0] ?? null;
};

const getSubathonConfig = async () => {
  const config = await db.select().from(subathonConfigTable).limit(1);
  return config[0] ?? null;
};

const getEvents = async () => {
  return await db.select().from(eventsTable).orderBy(eventsTable.time);
};

const startSubathon = async (initialMinutes: number) => {
  console.log(`Starting subathon with ${initialMinutes} initial minutes`);
  const now = Math.floor(Date.now() / 1000);
  const sunday = new Date();
  sunday.setDate(sunday.getDate() + (7 - sunday.getDay()));
  sunday.setHours(21, 0, 0, 0);
  const maxEndTime = Math.floor(sunday.getTime() / 1000);

  await db
    .insert(subathonConfigTable)
    .values({
      maxEndTime,
      maxSleepTimeNight: 4 * 60 * 60,
      maxSleepTimeDay: 1 * 60 * 60,
      goals: {},
      points: 0,
    })
    .onConflictDoUpdate({
      target: subathonConfigTable.id,
      set: {
        maxEndTime,
        points: 0,
      },
    });

  await db
    .insert(subathonStateTable)
    .values({
      isActive: true,
      startTimeUnix: now,
      endTimeUnix: now + initialMinutes * 60,
      timeRemaining: initialMinutes * 60,
    })
    .onConflictDoUpdate({
      target: subathonStateTable.id,
      set: {
        isActive: true,
        startTimeUnix: now,
        endTimeUnix: now + initialMinutes * 60,
        timeRemaining: initialMinutes * 60,
      },
    });

  await db.delete(eventsTable);

  const [state, config, events] = await Promise.all([
    getSubathonState(),
    getSubathonConfig(),
    getEvents(),
  ]);

  console.log(
    `Subathon started. End time set to: ${new Date(maxEndTime * 1000)}`
  );
  io.emit("subathonUpdate", {
    timeRemaining: state?.timeRemaining ?? 0,
    isActive: state?.isActive ?? false,
    events,
    config,
  });
};

const endSubathon = async () => {
  await db.update(subathonStateTable).set({
    isActive: false,
    timeRemaining: 0,
    startTimeUnix: null,
    endTimeUnix: null,
  });

  const [state, events] = await Promise.all([getSubathonState(), getEvents()]);

  io.emit("subathonUpdate", {
    timeRemaining: 0,
    isActive: false,
    events,
  });
};

io.on("connection", async (socket: Socket) => {
  console.log("a user connected");

  const [state, events] = await Promise.all([getSubathonState(), getEvents()]);

  socket.emit("subathonUpdate", {
    timeRemaining: state?.timeRemaining ?? 0,
    isActive: state?.isActive ?? false,
    events,
  });

  socket.on("startSubathon", (minutes: number) => {
    console.log("Subaton start, " + minutes);
    startSubathon(minutes);
  });

  socket.on("endSubathon", () => {
    console.log("Ended subaton");
    endSubathon();
  });

  socket.addListener("disconnect", () => {
    console.log("user disconnected");
  });
});

const addSubathonTime = async (minutes: number) => {
  console.log(`Attempting to add ${minutes} minutes to subathon`);
  const state = await getSubathonState();
  if (state?.isActive) {
    const newTimeRemaining = (state.timeRemaining ?? 0) + minutes * 60;
    console.log(`New time remaining: ${newTimeRemaining} seconds`);

    await db.update(subathonStateTable).set({
      timeRemaining: newTimeRemaining,
      endTimeUnix: (state.startTimeUnix ?? 0) + newTimeRemaining,
    });

    const [updatedState, config, events] = await Promise.all([
      getSubathonState(),
      getSubathonConfig(),
      getEvents(),
    ]);

    io.emit("subathonUpdate", {
      timeRemaining: updatedState?.timeRemaining ?? 0,
      isActive: updatedState?.isActive ?? false,
      events,
      config,
    });
  } else {
    console.log("Cannot add time: subathon is not active");
  }
};

const addPoints = async (amount: number) => {
  console.log(`Adding ${amount} points`);
  const config = await getSubathonConfig();
  const newPoints = (config?.points ?? 0) + amount;

  await db.update(subathonConfigTable).set({ points: newPoints });

  io.emit("pointsUpdate", newPoints);
};

const start = async () => {
  if (!clientId || !clientSecret || !userId) {
    console.error("Missing clientId, clientSecret, or userId");
    return;
  }
  const authProvider = new RefreshingAuthProvider({
    clientId,
    clientSecret,
  });

  authProvider.onRefresh(
    async (userId, newTokenData) =>
      await fs.promises.writeFile(
        `./tokens/tokens.${userId}.json`,
        JSON.stringify(newTokenData, null, 4),
        "utf8"
      )
  );

  const tokenData = JSON.parse(
    await fs.promises.readFile(`./tokens/tokens.${userId}.json`, "utf8")
  );

  await authProvider.addUserForToken(tokenData, ["chat"]);

  await authProvider.addIntentsToUser(userId, [
    "channel:manage:redemptions",
    "channel:read:redemptions",
    "chat:edit",
    "chat:read",
    "channel:manage:polls",
  ]);

  const apiClient = new ApiClient({ authProvider });
  const listener = new EventSubWsListener({ apiClient });

  listener.start();

  const addEvent = async (event: Event) => {
    await db.insert(eventsTable).values({
      event: event.event,
      time: event.time,
      user: event.user,
    });

    const events = await getEvents();
    return events;
  };

  listener.onChannelRedemptionAdd(userId, async (e) => {
    try {
      switch (e.rewardTitle.toLowerCase()) {
        case "add_subathon_time_5":
          addSubathonTime(5);
          addEvent({
            event: "Channel Point Redeem",
            user: e.userDisplayName,
            time: new Date(),
          });
          break;
        case "add_subathon_time_10":
          addSubathonTime(10);
          addEvent({
            event: "Channel Point Redeem",
            user: e.userDisplayName,
            time: new Date(),
          });
          break;
      }
    } catch (error) {
      console.log(error);
    }
  });

  const calculateSubTime = (tier: string) => {
    switch (tier) {
      case "1":
        return 5;
      case "2":
        return 10;
      case "3":
        return 15;
      default:
        console.log("Unknown tier", tier);
        return 5;
    }
  };

  const calculateCheerTime = (amount: number) => {
    return amount / 60;
  };

  listener.onChannelSubscription(userId, (e) => {
    console.log(`Subscription received from ${e.userDisplayName}`);
    addSubathonTime(10);
    addPoints(1);
    addEvent({
      event: "Subscription",
      user: e.userDisplayName,
      time: new Date(),
    });
  });

  listener.onChannelSubscriptionGift(userId, (e) => {
    console.log(`${e.broadcasterDisplayName} just gifted a subscription!`);
    addSubathonTime(calculateSubTime(e.tier));
    addEvent({
      event: `Sub Gift (Tier ${e.tier})`,
      user: e.gifterDisplayName,
      time: new Date(),
    });
  });

  listener.onChannelFollow(userId, userId, (e) => {
    console.log(`${e.broadcasterDisplayName} just followed!`);
    addSubathonTime(1);
    addEvent({
      event: "Follow",
      user: e.userDisplayName,
      time: new Date(),
    });
  });

  listener.onChannelCheer(userId, (e) => {
    const minutes = Math.floor(e.bits / 200) * 5;
    const points = Math.floor(e.bits / 400);
    console.log(
      `Cheer received: ${e.bits} bits = ${minutes} minutes and ${points} points`
    );
    addSubathonTime(minutes);
    addPoints(points);
    addEvent({
      event: `Cheer (${e.bits} bits)`,
      user: e.userDisplayName!,
      time: new Date(),
    });
  });

  listener.onChannelRaidFrom(userId, (e) => {
    addSubathonTime(10);
    addEvent({
      event: `Raid (${e.viewers} viewers)`,
      user: e.raidingBroadcasterDisplayName,
      time: new Date(),
    });
  });
  /* 
  listener.onChannelChatMessage(userId, userId, e => {
    console.log(e);
    if(e.messageText.length > 200) {
      chatClient.say('huikkakoodaa', " i ain't reading all that. im happy for you tho, or sorry that happened.");
      return;
    }
  }); */
};

app.get("/api/amounts/live", async (req, res) => {
  console.log("Fetching live amounts");
  try {
    const [state, config] = await Promise.all([
      getSubathonState(),
      getSubathonConfig(),
    ]);

    console.log("State:", state);
    console.log("Config:", config);
    // Calculate counts from events table
    const events = await getEvents();
    const stats = events.reduce(
      (acc, event) => {
        switch (event.event) {
          case "Subscription":
            acc.subCount++;
            break;
          case "Follow":
            acc.followCount++;
            break;
          case event.event.match(/Cheer/)?.input:
            // Extract bits from "Cheer (X bits)"
            const bits = parseInt(
              event.event.match(/\((\d+) bits\)/)?.[1] || "0"
            );
            acc.bitCount += bits;
            break;
        }
        console.log("returning", acc);
        return acc;
      },
      { subCount: 0, followCount: 0, bitCount: 0, viewerCount: 0 }
    );

    res.json({
      ...stats,
      endTime: state?.endTimeUnix || 0,
    });
  } catch (error) {
    console.error("Error fetching live stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/points/now", async (req, res) => {
  console.log("Accessing /api/points/now endpoint");
  try {
    const [state, config] = await Promise.all([
      getSubathonState(),
      getSubathonConfig(),
    ]);

    console.log("Database query results:", { state, config });

    if (!config) {
      console.log("No config found");
      return res.status(404).json({ error: "No configuration found" });
    }

    const response = {
      amountOfPoints: config.points || 0,
      timeLeft: state?.endTimeUnix || 0,
    };

    console.log("Sending response:", response);
    return res.json(response);
  } catch (error) {
    console.error("Error in /api/points/now:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

start();
