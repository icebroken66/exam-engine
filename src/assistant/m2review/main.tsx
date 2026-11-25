import ReactDOM from 'react-dom/client'
import {WorkspaceReview} from './WorkspaceReview'
import '../../reader/boardui.generated.css'
import '../../theme.css'
import '../../reader/workbench/workbench.css'
import '../conversation.css'
import './review.css'
ReactDOM.createRoot(document.getElementById('root')!).render(<WorkspaceReview/>)
