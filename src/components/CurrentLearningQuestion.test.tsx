import {it,expect} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {CurrentLearningQuestion} from './CurrentLearningQuestion'
import type {LearningTask} from '../lib/clients/learning'
it.each([['missing','答案待确认'],['source','原卷答案'],['ai','AI 参考答案'],['human','人工校订答案']] as const)('labels original question answer provenance %s accurately',(answer_provenance,label)=>{
 const task={kind:'diagnostic',stem:'原题',knowledge_point:'边界',provenance:'original',answer_provenance,validation_confidence:null,rubric:[]} as unknown as LearningTask
 const html=renderToStaticMarkup(<CurrentLearningQuestion task={task} graded={false}/>)
 expect(html).toContain('真实原题 · '+label)
 if(answer_provenance==='missing')expect(html).not.toContain('原卷答案')
})
