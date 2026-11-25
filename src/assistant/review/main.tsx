import React from 'react'
import ReactDOM from 'react-dom/client'
import {AssistantReview} from './Review'
import '../../reader/boardui.generated.css'
import '../../theme.css'
import '../../reader/workbench/workbench.css'
import './review.css'
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AssistantReview/></React.StrictMode>)
