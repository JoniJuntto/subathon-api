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

type SubathonConfig = {
  maxEndTime: number; // Sunday 21:00 timestamp
  maxSleepTime: {
    night: number; // 4 hours in seconds
    day: number; // 1 hour in seconds
  };
  goals: Map<number, string>;
  points: number;
};

let subathonConfig: SubathonConfig = {
  maxEndTime: 0, // Will be set when subathon starts
  maxSleepTime: {
    night: 4 * 60 * 60,
    day: 1 * 60 * 60,
  },
  goals: new Map([
    [1, "Assembly liput arvontaan 2x2 kpl"],
    [2, "Korjataan subathon kello"],
    [3, "Koiranulkoituslive"],
    [5, "Kissan korvat subathonin ajaks"],
    [7, "Funlight tier list"],
    [9, "Kalja ykkösellä"],
    [10, "Kaljamaili Forsun kanssa"],
    [11, "Lähetetään Funlightille sponsorointi pyyntö"],
    [15, "Kokki live (tehää ruokaa emt)"],
    [17, "Kalja ykkösellä"],
    [18, "Chat saa päättää aiheen ja scriptin Tiktok videolle"],
    [20, "Kick kanava"],
    [25, "Toteutetaan chatin päättämä SaaS idea"],
    [30, "Kalja ykkösellä"],
    [31, "Kokkilive"],
    [40, "Haetaan Jumaljoni"],
    [50, "Mennään kahville Juhikselle"],
    [69, "Tehdään katsojien päättämä pizza"],
    [75, "Jokelan paikalliseen kaljalle (haetaan Wiineri mukaan)"],
    [84, "1h karaoke"],
    [100, "Minecraft skywars"],
    [150, "Perustetaan Minecraft HuikaaPelaa let’s play kanava"],
    [200, "Juoksukaljat"],
    [500, "Thaimaahan Pottukoiran kanssa (tarvii pottukoiran hyväksynnän)"],
    [666, "Kirkkoon"],
    [667, "Järjestetään reivit ja essot naamaan (ne baarit ei huumeet)"],
    [900, "Deadline vaihtuu keskiviikkoon"],
    [1000, "Mutsi koodaa"],
    [1100, "Viljami messiin"],
    [1200, "Varahahmo messiin"],
    [1234, "tilataan naapurille fentanyliä netistä"],
    [1500, "Haetaan Riinatti"],
    [2000, "Modien kanssa ruotsin laivalle (juhis tarjoo)"],
    [2345, "MMA matsi munasillaan isännöitsijän kanssa"],
    [3000, "Soitetaan duunii"],
    [4000, "kirjoitetaan kirja jokelassa asumisesta"],
    [728536, "MAAILMANENNÄTYS (kalja ykkösellä)"],
  ]),
  points: 0,
};

const startSubathon = (initialMinutes: number) => {
  subathonActive = true;
  subathonTimeRemaining = initialMinutes * 60;
  subathonStartTimeUnix = Math.floor(Date.now() / 1000);
  subathonEndTimeUnix = subathonStartTimeUnix + initialMinutes * 60;

  eventHistory = [];

  const now = new Date();
  const sunday = new Date();
  sunday.setDate(now.getDate() + (7 - now.getDay()));
  sunday.setHours(21, 0, 0, 0);
  subathonConfig.maxEndTime = Math.floor(sunday.getTime() / 1000);

  io.emit("subathonUpdate", {
    timeRemaining: subathonTimeRemaining,
    isActive: subathonActive,
    events: eventHistory,
    config: subathonConfig,
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
    timeRemaining: subathonTimeRemaining,
    isActive: subathonActive,
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

const addPoints = (amount: number) => {
  subathonConfig.points += amount;
  io.emit("pointsUpdate", subathonConfig.points);
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

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

start();
