import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as Mock from 'mockjs';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('ajx-docgen.generate', (uri: vscode.Uri) => {
    const markdownString = convertToMarkdown(uri.fsPath);
    const docPath = uri.fsPath.replace(path.extname(uri.fsPath), '.md');
    fs.writeFileSync(docPath, markdownString);
    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(docPath));
  });
  context.subscriptions.push(disposable);
}

function convertToMarkdown(filePath: string) {
    const program = ts.createProgram([filePath], {});
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(filePath);
    let mdContent = '';

    // 检查 sourceFile 是否存在
    if(sourceFile){
        let commentLines = ts.getLeadingCommentRanges(sourceFile.getFullText(), 0);
        // 提取文件顶部的注释
        if(commentLines) {
            let commentText = sourceFile.getFullText().substring(commentLines[0].pos, commentLines[0].end);
            // 删除注释标记
            commentText = commentText.replace(/\/\*\*|\*\/|\*/g, '');
            // 在注释前后添加 ---
            mdContent += "---\n" + commentText.trim() + "\n---\n\n";
        }
    }
    
    const fileName = path.basename(filePath, path.extname(filePath));

    if (sourceFile) {
        ts.forEachChild(sourceFile, (node) => visit(node, checker));
    }
    return mdContent;

    function visit(node: ts.Node, checker: ts.TypeChecker) {
      if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        mdContent += generateMarkdownForNode(node, checker, fileName);
      } else {
        ts.forEachChild(node, (node) => visit(node, checker));
      }
    }
}

function generateMarkdownForNode(node: ts.Node, checker: ts.TypeChecker, fileName: string): string {
  let mdContent = '';
    mdContent += `## 引入方式\n\n\`\`\`jsx\nimport ${fileName} from '${fileName}';\n\`\`\`\n\n`;
    if (ts.isInterfaceDeclaration(node)) {
        const  {mdContent: content, mockContent} = generateMarkdownForMembers(node, checker, fileName);
        mdContent += `## 示例\n\n\`\`\`jsx\n`;
        mdContent += `<${fileName} ${mockContent.trim()}>children</${fileName}>\n`;
        mdContent += `\`\`\`\n\n`;
        mdContent += `## 属性\n\n`;
        mdContent += `| 属性 | 说明 | 类型 | 默认值 |\n| --- | --- | --- | --- |\n`;
        mdContent += content;
    }
  return mdContent;
}

function generateMarkdownForMembers(node: ts.InterfaceDeclaration, checker: ts.TypeChecker, fileName: string): {mdContent: string, mockContent: string} {
  let mdContent = '';
  let mockContent = '';
  node.members.forEach(member => {
    if (ts.isPropertySignature(member)) {
      const nameSymbol = checker.getSymbolAtLocation(member.name);
      if (nameSymbol) {
        let description = ts.displayPartsToString(nameSymbol.getDocumentationComment(checker));
        const regex = /\/\/(.*)\n/g;
        const comments = [];
        let match;
        while ((match = regex.exec(member.getFullText())) !== null) {
          comments.push(match[1].trim());
        }
        description += ' ' + comments.join(' ');
        const type = checker.typeToString(checker.getTypeOfSymbolAtLocation(nameSymbol, member));
        mdContent += `| ${nameSymbol.getName()} | ${description.trim()} | \`${type}\` | - |\n`;
        let propName = nameSymbol.getName();
        let propValue = generateMockValue(checker.typeToString(checker.getTypeOfSymbolAtLocation(nameSymbol, member)));
        propValue && (mockContent += `${propName}=${propValue} `);
      }
    }
  });
  
  return {mdContent, mockContent};
}


function generateMockValue(type: string): string {
  switch (type) {
    case 'string':
      // 使用Mock生成一个随机的字符串
      return `'${Mock.Random.word()}'`;
    case 'number':
      // 使用Mock生成一个随机的数字
      return `{${Mock.Random.number()}}`;
    case 'boolean':
      // 使用Mock生成一个随机的布尔值
      return `{${Mock.Random.boolean()}}`;
    default:
      // 对于其他复杂类型，返回一个占位符
      return '';
  }
}
