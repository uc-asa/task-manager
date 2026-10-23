import mongoose from 'mongoose';
import { TaskPriority, TaskStatus, type TaskInput } from 'shared';
import { env } from '../config/env.js';
import { Task } from '../modules/tasks/task.model.js';

// Usage: npm run seed -w server            (only if the collection is empty)
//        npm run seed -w server -- --reset (wipes all tasks first)

const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar day relative to today, as midnight UTC (how the API stores due dates). */
const dayFromToday = (offset: number) => {
  const date = new Date(Date.now() + offset * DAY_MS);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const samples: (Omit<TaskInput, 'dueDate'> & { dueInDays: number | null })[] = [
  {
    title: 'Submit tax documents',
    description: 'Collect Form 16 and bank statements.',
    status: TaskStatus.Todo,
    priority: TaskPriority.High,
    dueInDays: -3,
  },
  {
    title: 'Review pull request #42',
    description: '',
    status: TaskStatus.InProgress,
    priority: TaskPriority.High,
    dueInDays: 0,
  },
  {
    title: 'Plan team offsite',
    description: 'Shortlist venues in Goa and send a poll.',
    status: TaskStatus.Todo,
    priority: TaskPriority.Medium,
    dueInDays: 14,
  },
  {
    title: 'Renew domain',
    description: 'Auto-renew failed last year.',
    status: TaskStatus.Todo,
    priority: TaskPriority.Medium,
    dueInDays: 30,
  },
  {
    title: 'Write release notes',
    description: '',
    status: TaskStatus.InProgress,
    priority: TaskPriority.Low,
    dueInDays: 2,
  },
  {
    title: 'Fix flaky checkout test',
    description: 'Fails roughly 1 in 20 runs on CI.',
    status: TaskStatus.Todo,
    priority: TaskPriority.High,
    dueInDays: 1,
  },
  {
    title: 'Book dentist appointment',
    description: '',
    status: TaskStatus.Done,
    priority: TaskPriority.Low,
    dueInDays: -10,
  },
  {
    title: 'Upgrade dependencies',
    description: 'Run the audit and bump minor versions.',
    status: TaskStatus.Done,
    priority: TaskPriority.Medium,
    dueInDays: -1,
  },
  {
    title: 'Read "Designing Data-Intensive Applications"',
    description: 'Chapters 5-7 this month.',
    status: TaskStatus.InProgress,
    priority: TaskPriority.Low,
    dueInDays: null,
  },
  {
    title: 'Clean up the backlog',
    description: '',
    status: TaskStatus.Todo,
    priority: TaskPriority.Low,
    dueInDays: null,
  },
  {
    title: 'Prepare interview demo',
    description: 'Record a 3-minute walkthrough.',
    status: TaskStatus.Todo,
    priority: TaskPriority.High,
    dueInDays: 5,
  },
  {
    title: 'Water the plants',
    description: '',
    status: TaskStatus.Todo,
    priority: TaskPriority.Low,
    dueInDays: -1,
  },
];

async function main() {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed sample data in production');
  }

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
  const reset = process.argv.includes('--reset');

  if (reset) {
    const { deletedCount } = await Task.deleteMany({});
    console.log(`Removed ${String(deletedCount)} existing task(s)`);
  } else if ((await Task.estimatedDocumentCount()) > 0) {
    console.log('Tasks already exist, nothing seeded. Use --reset to replace them.');
    return;
  }

  await Task.insertMany(
    samples.map(({ dueInDays, ...task }) => ({
      ...task,
      dueDate: dueInDays === null ? null : dayFromToday(dueInDays),
    })),
  );
  console.log(`Seeded ${String(samples.length)} tasks into ${mongoose.connection.name}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
