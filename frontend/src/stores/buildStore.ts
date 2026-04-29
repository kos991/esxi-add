import { create } from 'zustand'
import { BuildTask } from '../types'

interface BuildStore {
  activeBuildId: string | null
  setActiveBuildId: (id: string | null) => void
  taskCache: Record<string, BuildTask>
  updateTask: (task: BuildTask) => void
}

export const useBuildStore = create<BuildStore>((set) => ({
  activeBuildId: null,
  setActiveBuildId: (id) => set({ activeBuildId: id }),
  taskCache: {},
  updateTask: (task) => set((s) => ({ taskCache: { ...s.taskCache, [task.task_id]: task } })),
}))
