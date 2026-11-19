import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const { model, models } = mongoose;
const opts = { versionKey: false } as const;

const notifyCfg = new Schema(
  {
    preStart: { enabled: { type: Boolean, default: true }, minutesBefore: { type: Number, default: 10 } },
    start: { enabled: { type: Boolean, default: true } },
    end: { enabled: { type: Boolean, default: true } },
    overdue: { enabled: { type: Boolean, default: true }, minutesAfterEnd: { type: Number, default: 15 } },
  },
  { _id: false },
);

export const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    timezone: { type: String, default: 'Africa/Nairobi' },
    emailVerified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);

export const settingsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, unique: true },
    theme: { type: String, enum: ['dark', 'light', 'system'], default: 'dark' },
    weekStartsOn: { type: Number, min: 0, max: 6, default: 1 },
    soundEnabled: { type: Boolean, default: true },
    sound: { type: String, default: 'chime' },
    reducedMotion: { type: Boolean, default: false },
    introSeen: { type: Boolean, default: false },
    defaultNotify: { type: notifyCfg, default: () => ({}) },
  },
  opts,
);

/** Embedded work-session record: the input to core/accounting.evaluateSession. */
const sessionFields = {
  checkInAt: Number,
  checkOutAt: Number,
  pauses: [new Schema({ start: Number, end: Number }, { _id: false })],
  interruptions: [new Schema({ start: Number, end: Number, reason: String }, { _id: false })],
  markedMissed: { type: Boolean, default: false },
  endedByInterruption: { type: Boolean, default: false },
};

export const activitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '' },
    category: { type: String, default: 'general', trim: true },
    color: { type: String, default: '#7c5cff' },
    location: { type: String, default: '' },
    startUtc: { type: Number, required: true },
    endUtc: { type: Number, required: true },
    cancelled: { type: Boolean, default: false },
    notify: { type: notifyCfg, default: () => ({}) },
    seriesId: String,
    ...sessionFields,
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
activitySchema.index({ userId: 1, startUtc: 1 });

export const reminderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '' },
    spec: { type: Schema.Types.Mixed, required: true }, // core/recurrence ReminderSpec (validated by zod + validateSpec)
    active: { type: Boolean, default: true },
    latePolicy: { type: String, enum: ['send', 'expire'], default: 'expire' },
    maxLateMinutes: { type: Number, default: 120 },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);

export const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    endpoint: { type: String, required: true },
    endpointHash: { type: String, required: true, unique: true },
    keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
    userAgent: String,
    active: { type: Boolean, default: true },
    expiredReason: String,
    lastAcceptedAt: Number,
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);

export const deviceSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    refreshHash: { type: String, required: true, index: true },
    userAgent: String,
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
  },
  opts,
);
deviceSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** One-time tokens for e-mail verification and password reset (only the hash is stored). */
export const authTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    purpose: { type: String, enum: ['verify', 'reset'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
  },
  opts,
);

export const habitSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: '#35d0a0' },
    weekdays: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    archived: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);
export const habitCompletionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    habitId: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
  },
  opts,
);
habitCompletionSchema.index({ habitId: 1, date: 1 }, { unique: true });

export const goalSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    title: { type: String, required: true, trim: true },
    target: { type: Number, default: 100 },
    progress: { type: Number, default: 0 },
    unit: { type: String, default: '%' },
    dueDate: String,
    done: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);

export const focusSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    label: { type: String, default: 'Focus' },
    plannedMinutes: { type: Number, required: true },
    startedAt: { type: Number, required: true },
    endedAt: Number,
    completed: { type: Boolean, default: false },
  },
  opts,
);

export const reflectionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    mood: { type: Number, min: 1, max: 5 },
    wins: { type: String, default: '' },
    improve: { type: String, default: '' },
  },
  opts,
);
reflectionSchema.index({ userId: 1, date: 1 }, { unique: true });

export const sharedScheduleSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    title: { type: String, default: 'My schedule' },
    from: { type: String, required: true },
    to: { type: String, required: true },
    revoked: { type: Boolean, default: false },
    expiresAt: Date,
    createdAt: { type: Date, default: Date.now },
  },
  opts,
);

function m<T extends Schema>(name: string, s: T) {
  return (models[name] as mongoose.Model<InferSchemaType<T>>) ?? model<InferSchemaType<T>>(name, s);
}

export const User = m('User', userSchema);
export const UserSettings = m('UserSettings', settingsSchema);
export const Activity = m('Activity', activitySchema);
export const Reminder = m('Reminder', reminderSchema);
export const NotificationSubscription = m('NotificationSubscription', subscriptionSchema);
export const DeviceSession = m('DeviceSession', deviceSessionSchema);
export const AuthToken = m('AuthToken', authTokenSchema);
export const Habit = m('Habit', habitSchema);
export const HabitCompletion = m('HabitCompletion', habitCompletionSchema);
export const Goal = m('Goal', goalSchema);
export const FocusSession = m('FocusSession', focusSessionSchema);
export const DailyReflection = m('DailyReflection', reflectionSchema);
export const SharedSchedule = m('SharedSchedule', sharedScheduleSchema);

export const ALL_MODELS = [User, UserSettings, Activity, Reminder, NotificationSubscription, DeviceSession, AuthToken, Habit, HabitCompletion, Goal, FocusSession, DailyReflection, SharedSchedule];
