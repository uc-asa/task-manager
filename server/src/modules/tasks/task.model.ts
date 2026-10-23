import { Schema, model } from 'mongoose';
import { TASK_PRIORITIES, TASK_STATUSES, TaskLimits, TaskPriority, TaskStatus } from 'shared';

export interface ITask {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    title: { type: String, required: true, trim: true, maxlength: TaskLimits.TitleMax },
    description: { type: String, default: '', trim: true, maxlength: TaskLimits.DescriptionMax },
    status: { type: String, enum: TASK_STATUSES, default: TaskStatus.Todo },
    priority: { type: String, enum: TASK_PRIORITIES, default: TaskPriority.Medium },
    dueDate: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true, // exposes `id`
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret._id;
        return ret;
      },
    },
  },
);

// Indexes match the list query exactly: equality filters first, then the sort keys INCLUDING the
// `_id` tiebreaker (without it MongoDB cannot return rows in index order and falls back to an
// in-memory SORT over every matching document). Measured on 50,000 tasks, see DECISIONS.md.
taskSchema.index({ createdAt: -1, _id: -1 }); // default list: newest first, no filter
taskSchema.index({ status: 1, createdAt: -1, _id: -1 }); // status tab
taskSchema.index({ priority: 1, createdAt: -1, _id: -1 }); // priority filter
// Overdue count: the range on dueDate excludes null, and status is checked inside the index.
taskSchema.index({ dueDate: 1, status: 1 });

export const Task = model<ITask>('Task', taskSchema);
