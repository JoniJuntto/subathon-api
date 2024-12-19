import * as dotenv from "dotenv";
import { RefreshingAuthProvider } from "@twurple/auth";
import * as fs from "fs";
import { ApiClient } from "@twurple/api";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { Server, Socket } from "socket.io";
import express, { Application } from "express";
import cors from "cors";
import http from "http";

dotenv.config();

const app: Application = express();
const port = process.env.PORT || 8000;

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

let eventHistory: Event[] = [];
let subathonEndTimeUnix: number | null = null;
let subathonStartTimeUnix: number | null = null;
let subathonActive: boolean = false;
let subathonTimeRemaining: number = 0;

const startSubathon = (initialMinutes: number) => {
  subathonActive = true;
  subathonTimeRemaining = initialMinutes * 60;
  subathonStartTimeUnix = Math.floor(Date.now() / 1000);
  subathonEndTimeUnix = subathonStartTimeUnix + initialMinutes * 60;

  eventHistory = [];

  io.emit("subathonUpdate", {
    timeRemaining: subathonTimeRemaining,
    isActive: subathonActive,
    events: eventHistory,
  });
};

const endSubathon = () => {
  subathonActive = false;
  subathonTimeRemaining = 0;
  subathonStartTimeUnix = null;
  subathonEndTimeUnix = null;

  io.emit("subathonUpdate", {
    timeRemaining: 0,
    isActive: false,
    events: eventHistory,
  });
};

io.on("connection", (socket: Socket) => {
  console.log("a user connected");
  socket.emit("subathonUpdate", {
    timeAdded: 0,
    events: eventHistory,
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

const addSubathonTime = (minutes: number) => {
  if (subathonActive) {
    console.log("Adding subathon time", minutes);
    subathonTimeRemaining += minutes * 60;
    io.emit("subathonUpdate", {
      timeRemaining: subathonTimeRemaining,
      isActive: subathonActive,
      events: eventHistory,
    });
  }
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

  const addEvent = (event: Event) => {
    console.log("Adding event", event);
    console.log(eventHistory);
    eventHistory.push(event);
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
    console.log(`${e.broadcasterDisplayName} just subscribed!`);
    addSubathonTime(4);
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
    console.log(`${e.broadcasterDisplayName} just cheered!`);
    addSubathonTime(calculateCheerTime(e.bits));
    addEvent({
      event: `Cheer (${e.bits} bits)`,
      user: e.userDisplayName,
      time: new Date(),
    });
  });

  listener.onChannelRaidFrom(userId, (e) => {
    chatClient.say(e.raidedBroadcasterName, `Lisää kelloon 10 minuuttia!`);
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

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

start();
