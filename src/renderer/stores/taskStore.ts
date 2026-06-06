import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type TaskType = 'pull' | 'delete' | 'load' | 'unload' | 'download'

export interface Task {
  id: string
  type: TaskType
  modelName: string
  label: string
  progress: number // 0-100, -1 for indeterminate
  totalBytes: number
  completedBytes: number
  speedBps: number
  etaSec: number
  status: TaskStatus
  error?: string
  startedAt: number
  completedAt?: number
}

interface TaskStore {
  tasks: Record<string, Task>
  addTask: (task: Omit<Task, 'id' | 'status' | 'startedAt' | 'totalBytes' | 'completedBytes' | 'speedBps' | 'etaSec'> & { status?: TaskStatus }) => string
  updateProgress: (id: string, progress: number, totalBytes?: number, completedBytes?: number, speedBps?: number) => void
  completeTask: (id: string) => void
  failTask: (id: string, error: string) => void
  cancelTask: (id: string) => void
  removeTask: (id: string) => void
  clearCompleted: () => void
  getActiveTasks: () => Task[]
  getTaskByModel: (modelName: string, type?: TaskType) => Task | undefined
  hasActiveTask: (modelName: string, type?: TaskType) => boolean
}

export const useTaskStore = create<TaskStore>()(
  subscribeWithSelector((set, get) => ({
    tasks: {},

    addTask: (task) => {
      const id = `${task.type}-${task.modelName}-${Date.now()}`
      set((s) => ({
        tasks: {
          ...s.tasks,
          [id]: {
            ...task,
            id,
            status: task.status ?? 'queued',
            startedAt: Date.now(),
            totalBytes: 0,
            completedBytes: 0,
            speedBps: 0,
            etaSec: -1
          }
        }
      }))
      return id
    },

    updateProgress: (id, progress, totalBytes, completedBytes, speedBps) =>
      set((s) => {
        const existing = s.tasks[id]
        if (!existing) return s
        const tb = totalBytes ?? existing.totalBytes
        const cb = completedBytes ?? existing.completedBytes
        const sb = speedBps ?? existing.speedBps
        const eta = sb > 0 && tb > cb ? (tb - cb) / sb : -1
        return {
          tasks: {
            ...s.tasks,
            [id]: {
              ...existing,
              status: 'running',
              progress,
              totalBytes: tb,
              completedBytes: cb,
              speedBps: sb,
              etaSec: eta
            }
          }
        }
      }),

    completeTask: (id) =>
      set((s) => {
        const existing = s.tasks[id]
        if (!existing) return s
        return {
          tasks: {
            ...s.tasks,
            [id]: { ...existing, status: 'done', progress: 100, completedAt: Date.now() }
          }
        }
      }),

    failTask: (id, error) =>
      set((s) => {
        const existing = s.tasks[id]
        if (!existing) return s
        return {
          tasks: {
            ...s.tasks,
            [id]: { ...existing, status: 'error', error, completedAt: Date.now() }
          }
        }
      }),

    cancelTask: (id) =>
      set((s) => {
        const existing = s.tasks[id]
        if (!existing) return s
        return {
          tasks: {
            ...s.tasks,
            [id]: { ...existing, status: 'cancelled', completedAt: Date.now() }
          }
        }
      }),

    removeTask: (id) =>
      set((s) => {
        const { [id]: _, ...rest } = s.tasks
        return { tasks: rest }
      }),

    clearCompleted: () =>
      set((s) => {
        const tasks = Object.fromEntries(
          Object.entries(s.tasks).filter(([, t]) => t.status === 'queued' || t.status === 'running')
        )
        return { tasks }
      }),

    getActiveTasks: () =>
      Object.values(get().tasks).filter((t) => t.status === 'running' || t.status === 'queued'),

    getTaskByModel: (modelName, type) =>
      Object.values(get().tasks).find(
        (t) =>
          t.modelName === modelName &&
          (t.status === 'running' || t.status === 'queued') &&
          (!type || t.type === type)
      ),

    hasActiveTask: (modelName, type) => !!get().getTaskByModel(modelName, type)
  }))
)
