import { useParams } from 'react-router-dom'
import { TaskWorkspace } from '../components/TaskWorkspace'

export default function TaskDetailPage() {
  const { taskId } = useParams()
  return <TaskWorkspace initialTaskId={taskId} />
}
