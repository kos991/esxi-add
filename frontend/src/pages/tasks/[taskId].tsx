import { useParams } from '@umijs/max'
import { TaskWorkspace } from '../../components/TaskWorkspace'

export default function TaskDetailRoute() {
  const params = useParams()
  return <TaskWorkspace initialTaskId={params.taskId} />
}
