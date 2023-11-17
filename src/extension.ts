import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as Mock from 'mockjs';
import { exec } from 'child_process';
import { parse } from 'path';

export function activate(context: vscode.ExtensionContext) {
    const generate = vscode.commands.registerCommand('ajx-docgen.generate', async(uri: vscode.Uri) => {
        const docPath = uri.fsPath.replace(path.extname(uri.fsPath), '.md');
        // 检查 Markdown 文件是否已存在
        if (fs.existsSync(docPath)) {
            // 读取文件内容
            let content = fs.readFileSync(docPath, 'utf-8');
            // 生成新的属性表格
            const newPropsTable = generatePropsTable(uri.fsPath);
            // 替换原来的属性表格
            content = content.replace(/## 属性\n\n\| 属性 \| 说明 \| 类型 \| 默认值 \|\n\| --- \| --- \| --- \| --- \|\n([\s\S]*?)(?=\n##|$)/, newPropsTable);
            // 写回文件
            fs.writeFileSync(docPath, content);
        } else {
            // 如果文件不存在，就像之前一样生成新文件
            const comment = await generateComment() || '';
            const markdownString = comment + convertToMarkdown(uri.fsPath);
            fs.writeFileSync(docPath, markdownString);
        }
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(docPath));
    });
    const commands = [generate];
    context.subscriptions.push(...commands);
}

function convertToMarkdown(filePath: string) {
    const program = ts.createProgram([filePath], {});
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(filePath);
    let mdContent = '';

    // 检查 sourceFile 是否存在
    if (sourceFile) {
        let commentLines = ts.getLeadingCommentRanges(sourceFile.getFullText(), 0);
        // 提取文件顶部的注释
        if (commentLines) {
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
        const { mdContent: content, mockContent } = generateMarkdownForMembers(node, checker, fileName);
        mdContent += `## 示例\n\n\`\`\`jsx\n`;
        mdContent += `<${fileName} ${mockContent.trim()}>children</${fileName}>\n`;
        mdContent += `\`\`\`\n\n`;
        mdContent += `## 属性\n\n`;
        mdContent += `| 属性 | 说明 | 类型 | 默认值 |\n| --- | --- | --- | --- |\n`;
        mdContent += content;
    }
    return mdContent;
}
function generatePropsTable(filePath: string): string {
    const program = ts.createProgram([filePath], {});
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(filePath);
    const { name } = path.parse(filePath);
    const filename = name || '';
    let propsTable = `## 属性\n\n| 属性 | 说明 | 类型 | 默认值 |\n| --- | --- | --- | --- |\n`;

    if (sourceFile) {
        ts.forEachChild(sourceFile, (node) => {
            if (ts.isInterfaceDeclaration(node)) {
                const { mdContent } = generateMarkdownForMembers(node, checker, filename);
                propsTable += mdContent;
            }
        });
    }

    return propsTable;
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
  
          // 提取默认值
          let defaultValue = '-';
          const jsDocTags = ts.getJSDocTags(member);
          let descriptionWithTag = description;
          jsDocTags.forEach(tag => {
            if (tag.tagName.text === 'default') {
              // 提取 @default 标签的内容
              if (typeof tag.comment === 'string') {
                defaultValue = tag.comment;
              }
            } else {
              // 将其他注释添加到说明字段
              descriptionWithTag += ' ' + tag.comment;
            }
          });
  
          mdContent += `| ${nameSymbol.getName()} | ${descriptionWithTag.trim()} | \`${type}\` | ${defaultValue} |\n`;
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

function getGitFileCreator(): Promise<string> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || !activeEditor.document) {
        return Promise.reject('No active editor or document found.');
    }

    const uri = activeEditor.document.uri;
    const repository = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;

    if (!repository) {
        return Promise.reject('No repository found for the active file.');
    }

    const filePath = uri.fsPath;

    return new Promise((resolve, reject) => {
        // 执行 git log 命令获取文件的创建者
        exec(`git log --format="%an" --reverse --follow "${filePath}"`, { cwd: repository }, (error, stdout) => {
            if (error) {
                reject(error.message);
            } else {
                const creators = stdout.trim().split('\n');
                const firstCommitHash = stdout.trim().split('\n')[0] || '';
                const version = firstCommitHash.replace(/^[a-zA-Z]*\//, ''); // 提取版本号，去掉开头的字母和斜杠
                // 返回第一个提交的作者（即创建者）
                resolve(creators[0]);
            }
        });
    });
}
// 获取创建人的第一次提交哈希值并提取版本号
function getGitFirstCommitVersion(author: string): Promise<string | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    const repository = activeEditor ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri.fsPath : '';

    return new Promise((resolve, reject) => {
        exec(`git log --author="${author}" --format="%h" --reverse`, { cwd: repository }, (error, stdout) => {
            if (error) {
                reject(error.message);
            } else {
                const firstCommitHash = stdout.trim().split('\n')[0] || '';
                const version = firstCommitHash.replace(/^[a-zA-Z]*\//, ''); // 提取版本号，去掉开头的字母和斜杠
                resolve(version || undefined);
            }
        });
    });
}

// 获取创建人的第一个提交所在的分支名称作为版本号
function getGitFirstCommitBranch(author: string): Promise<string | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    const repository = activeEditor ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)?.uri.fsPath : '';
  
    return new Promise((resolve, reject) => {
      exec(`git log --author="${author}" --format="%D" --reverse`, { cwd: repository }, (error, stdout) => {
        if (error) {
          reject(error.message);
        } else {
          const branchInfo = stdout.trim().split('\n')[0] || '';
          const branchNameMatch = branchInfo.match(/(?:[^/]+\/){2}([^/]+)/); // 匹配分支名
          const branchName = branchNameMatch ? branchNameMatch[1] : undefined;
          resolve(branchName);
        }
      });
    });
  }
  
// 生成注释文本
async function generateComment() {
    try {
        const creator = await getGitFileCreator();
        const version = await getGitFirstCommitBranch(creator);
        const activeEditor = vscode.window.activeTextEditor;
        const filePath = activeEditor ? activeEditor.document.fileName : '';
        const { name } = parse(filePath);
        const filename = name || '';
        const comment = `---
type: Basic
title: ${filename}
subtitle: 文件名——中文
owner: ${creator}
version: ${version}
---\n\n`;
        // 返回注释
        return comment;
    } catch (error) {
        console.error('Error:', error);
    }
}