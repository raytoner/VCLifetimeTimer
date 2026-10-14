/**
 * @name VCLifetimeTimer
 * @author colonel_ingus
 * @version 1.0.0
 * @description Tracks and shows cumulative lifetime voice channel time spent with each user above their name in VC.
 */

const { Webpack, React, Patcher, Data, DOM, Utils } = BdApi;

const VoiceStateStore = Webpack.getStore("VoiceStateStore");
const UserStore = Webpack.getStore("UserStore");
const Dispatcher = Webpack.getByKeys("dispatch", "subscribe", "unsubscribe", { searchExports: true });

module.exports = class VCLifetimeTimer {
    constructor(meta) {
        this.meta = meta;
        this.times = Data.load("VCLifetimeTimer", "times") || {};
        this.currentSession = {}; // userId -> startTimestamp
        this.interval = null;
        this.currentChannelId = null;
    }

    start() {
        DOM.addStyle(this.meta.name, `
            div[class*="videoButton"],
            div[class*="participantName"],
            div[class*="tile"],
            div[class*="peopleListItem"],
            [class*="overlays"],
            [class*="hideControls"],
            .vc-lifetime-timer {
                opacity: 1 !important;
                visibility: visible !important;
                pointer-events: auto !important;
            }
            .vc-lifetime-timer {
                font-size: 11px;
                font-weight: 600;
                color: var(--text-normal);
                margin-top: 2px;
                font-family: monospace;
                text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            }
        `);

        this.updateCurrentUsers();
        Dispatcher.subscribe("VOICE_STATE_UPDATES", this.onVoiceUpdate.bind(this));

        this.interval = setInterval(() => this.tick(), 1000);

        // Patch voice user component to inject timer
        const VoiceUser = Webpack.getBySource?.("renderPrioritySpeaker") || Webpack.getModule(m => m?.type?.toString?.().includes("voiceUser") || m?.displayName === "VoiceUser");
        if (VoiceUser) {
            Patcher.after(this.meta.name, VoiceUser, "render", (thisObject, args, returnValue) => {
                try {
                    const userId = args[0]?.user?.id || args[0]?.userId;
                    if (!userId) return;
                    const timerEl = React.createElement("div", { className: "vc-lifetime-timer" }, this.formatTime(userId));
                    // Try to inject near the name
                    const nameNode = Utils.findInTree(returnValue, n => n?.props?.className?.includes?.("username") || n?.props?.className?.includes?.("name"), { walkable: ["props", "children"] });
                    if (nameNode && nameNode.props) {
                        if (!nameNode.props.children) nameNode.props.children = [];
                        if (Array.isArray(nameNode.props.children)) {
                            nameNode.props.children.push(timerEl);
                        } else {
                            nameNode.props.children = [nameNode.props.children, timerEl];
                        }
                    } else if (returnValue?.props?.children) {
                        returnValue.props.children = [returnValue.props.children, timerEl];
                    }
                } catch (e) {}
            });
        }
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        Dispatcher.unsubscribe("VOICE_STATE_UPDATES", this.onVoiceUpdate);
        this.save();
        Patcher.unpatchAll(this.meta.name);
        DOM.removeStyle(this.meta.name);
    }

    onVoiceUpdate() {
        this.updateCurrentUsers();
    }

    updateCurrentUsers() {
        const myId = UserStore.getCurrentUser()?.id;
        const myState = VoiceStateStore.getVoiceStateForUser(myId);
        this.currentChannelId = myState?.channelId || null;

        const now = Date.now();
        const stillWith = new Set();

        if (this.currentChannelId) {
            const states = VoiceStateStore.getVoiceStatesForChannel(this.currentChannelId) || {};
            for (const uid in states) {
                if (uid === myId) continue;
                stillWith.add(uid);
                if (!this.currentSession[uid]) {
                    this.currentSession[uid] = now;
                }
            }
        }

        // End sessions for people who left
        for (const uid in this.currentSession) {
            if (!stillWith.has(uid)) {
                this.accumulate(uid);
                delete this.currentSession[uid];
            }
        }
    }

    tick() {
        const now = Date.now();
        for (const uid in this.currentSession) {
            // Live update for display, actual save on accumulate
        }
        // Force re-render-ish by saving occasionally
        if (Math.random() < 0.05) this.save();
    }

    accumulate(uid) {
        if (!this.currentSession[uid]) return;
        const delta = Date.now() - this.currentSession[uid];
        this.times[uid] = (this.times[uid] || 0) + delta;
        this.save();
    }

    formatTime(uid) {
        let total = this.times[uid] || 0;
        if (this.currentSession[uid]) {
            total += Date.now() - this.currentSession[uid];
        }
        const sec = Math.floor(total / 1000);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}h ${m.toString().padStart(2,"0")}m ${s.toString().padStart(2,"0")}s`;
        if (m > 0) return `${m}m ${s.toString().padStart(2,"0")}s`;
        return `${s}s`;
    }

    save() {
        Data.save("VCLifetimeTimer", "times", this.times);
    }
};
