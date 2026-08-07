// 解析器统一入口：按文件扩展名分发
import { parseWord } from './word.js'
import { parseExcel } from './excel.js'

export async function parseFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx')) {
    return { source: 'word', questions: await parseWord(file) }
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return { source: 'excel', questions: await parseExcel(file) }
  }
  if (name.endsWith('.doc')) {
    throw new Error('不支持 .doc 旧格式，请用 Word "另存为 .docx" 后再导入')
  }
  throw new Error('不支持的文件格式，仅支持 .docx / .xlsx')
}
