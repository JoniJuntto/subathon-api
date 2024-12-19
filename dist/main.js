"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const auth_1 = require("@twurple/auth");
const fs = __importStar(require("fs"));
const api_1 = require("@twurple/api");
const eventsub_ws_1 = require("@twurple/eventsub-ws");
const socket_io_1 = require("socket.io");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
dotenv.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 8000;
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
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: corsOptions,
    pingTimeout: 60000,
});
app.use((0, cors_1.default)(corsOptions));
let eventHistory = [];
let subathonEndTimeUnix = null;
let subathonStartTimeUnix = null;
let subathonActive = false;
let subathonTimeRemaining = 0;
const startSubathon = (initialMinutes) => {
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
io.on("connection", (socket) => {
    console.log("a user connected");
    socket.emit("subathonUpdate", {
        timeRemaining: subathonTimeRemaining,
        isActive: subathonActive,
        events: eventHistory,
    });
    socket.on("startSubathon", (minutes) => {
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
const addSubathonTime = (minutes) => {
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
    const authProvider = new auth_1.RefreshingAuthProvider({
        clientId,
        clientSecret,
    });
    authProvider.onRefresh(async (userId, newTokenData) => await fs.promises.writeFile(`./tokens/tokens.${userId}.json`, JSON.stringify(newTokenData, null, 4), "utf8"));
    const tokenData = JSON.parse(await fs.promises.readFile(`./tokens/tokens.${userId}.json`, "utf8"));
    await authProvider.addUserForToken(tokenData, ["chat"]);
    await authProvider.addIntentsToUser(userId, [
        "channel:manage:redemptions",
        "channel:read:redemptions",
        "chat:edit",
        "chat:read",
        "channel:manage:polls",
    ]);
    const apiClient = new api_1.ApiClient({ authProvider });
    const listener = new eventsub_ws_1.EventSubWsListener({ apiClient });
    listener.start();
    const addEvent = (event) => {
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
        }
        catch (error) {
            console.log(error);
        }
    });
    const calculateSubTime = (tier) => {
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
    const calculateCheerTime = (amount) => {
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
