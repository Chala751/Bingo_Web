import mongoose from "mongoose";

const gameSchema = new mongoose.Schema({
  gameNumber: { type: Number, required: true },
  cashierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  betAmount: { type: Number, required: true },
  houseFeePercentage: { type: Number, required: true },
  houseFee: { type: Number, default: 0 },
  jackpotContribution: { type: Number, default: 0 }, // ✅ Added (from bug fix in logs)
  selectedCards: [
    // ✅ Light refs only—no numbers!
    {
      id: { type: Number, required: true }, // card_number for UI display
      cardRef: { type: Number, ref: "Card", required: true }, // ✅ FK to Card.card_number
      disqualified: { type: Boolean, default: false },
      checkCount: { type: Number, default: 0 },
      lastCheckCallCount: { type: Number, default: 0 },
      lastCheckTime: { type: Date, default: null },
      // ❌ REMOVED: numbers array → use populate('selectedCards.cardRef', 'numbers')
    },
  ],
  pattern: {
    type: String,
    required: true,
    enum: [
      "four_corners_center",
      "cross",
      "main_diagonal",
      "other_diagonal",
      "horizontal_line",
      "vertical_line",
      "all",
    ],
  },
  prizePool: { type: Number, required: true, default: 0 },
  potentialJackpot: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["pending", "active", "paused", "completed"],
    default: "pending",
  },
  calledNumbers: [{ type: Number }],
  calledNumbersLog: [
    {
      number: { type: Number, required: true },
      calledAt: { type: Date, default: Date.now },
    },
  ],
  moderatorWinnerCardId: { type: Number, default: null },
  forcedPattern: { type: String, default: null },
  selectedWinnerRowIndices: { type: [Number], default: [] },
  forcedCallSequence: { type: [Number], default: [] },
  forcedCallIndex: { type: Number, default: 0 },
  // Controls whether the server will accept auto next-call requests (no manual number specified)
  autoCallEnabled: { type: Boolean, default: true },
  // Server-enforced next allowed time for any subsequent calls (throttling survives restarts)
  nextAllowedAt: { type: Date, default: null },
  targetWinCall: { type: Number, default: null },
  winnerCardNumbers: {
    type: [[{ type: mongoose.Schema.Types.Mixed }]],
    default: null,
  },
  selectedWinnerNumbers: { type: [Number], default: [] },
  winner: {
    cardId: { type: Number },
    prize: { type: Number },
  },
  jackpotEnabled: { type: Boolean, default: true },
  // New jackpot fields
  jackpotWinnerCardId: { type: String, default: null },
  jackpotAwardedAmount: { type: Number, default: 0 },
  jackpotWinnerMessage: { type: String, default: null },
  jackpotDrawTimestamp: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  configuredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  configuredAt: { type: Date, default: null },
});

gameSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

gameSchema.index({ cashierId: 1, gameNumber: 1 }, { unique: true });

gameSchema.index({ _id: 1, calledNumbers: 1 });

export default mongoose.model("Game", gameSchema);
