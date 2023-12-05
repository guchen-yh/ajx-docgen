import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as Mock from 'mockjs';
import { exec } from 'child_process';
import { parse } from 'path';

export function activate(context: vscode.ExtensionContext) {
    const generate = vscode.commands.registerCommand('ajx-docgen.generate', async (uri: vscode.Uri) => {
        const docPath = uri.fsPath.replace(path.extname(uri.fsPath), '.md');
        // 调用函数来找到项目根目录
        // 检查 Markdown 文件是否已存在
        if (fs.existsSync(docPath)) {
            // 读取文件内容
            let content = fs.readFileSync(docPath, 'utf-8');
            // 生成新的属性表格
            const newPropsTable = await generatePropsTable(uri.fsPath);
            // 替换原来的属性表格
            content = content.replace(/## 属性\n\n\| 属性 \| 说明 \| 类型 \| 默认值 \|\n\| --- \| --- \| --- \| --- \|\n([\s\S]*?)(?=\n##|$)/, newPropsTable);
            // 写回文件
            fs.writeFileSync(docPath, content);
        } else {
            // 如果文件不存在，就像之前一样生成新文件
            const comment = await generateComment() || '';
            const mdContent = await convertToMarkdown(uri.fsPath);
            const markdownString = comment + mdContent;
            fs.writeFileSync(docPath, markdownString);
        }
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(docPath));
    });
    const commands = [generate];
    context.subscriptions.push(...commands);
}

async function convertToMarkdown(filePath: string) {
    const program = ts.createProgram([filePath], {});
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(filePath);
    let mdContent = '';
    const fileName = path.basename(filePath, path.extname(filePath));

    if (sourceFile) {
        const {importedModule, typeName} = getTypeOfPropsFromDefaultExport(sourceFile);
        if(importedModule && typeName){
            const moduleFilePath = await resolveModuleFilePath(importedModule);
            const program = ts.createProgram([moduleFilePath], {});
            const checker = program.getTypeChecker();
            const importsourceFile = program.getSourceFile(moduleFilePath);
            if(importsourceFile){
                ts.forEachChild(importsourceFile, (node) => {
                    if (ts.isInterfaceDeclaration(node)&&node.name.text === typeName) {
                        const declarationText = node.getText(sourceFile);
                        console.log('declarationText', declarationText);
                        const content = generateMarkdownForNode(node, checker, fileName);
                        mdContent += content;
                    }
                });
            }
        }else if(typeName){
            ts.forEachChild(sourceFile, (node) => visit(node, checker, typeName));
        }
    }
    return mdContent;
    
    function visit(node: ts.Node, checker: ts.TypeChecker, typeName: string) {
    
        if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
            if(node.name.text === typeName){
                mdContent += generateMarkdownForNode(node, checker, fileName);
            }
        } else {
            ts.forEachChild(node, (node) => visit(node, checker, typeName));
        }
    }
}

function generateMarkdownForNode(node: ts.Node, checker: ts.TypeChecker, fileName: string): string {
    let mdContent = '';
    mdContent += `## 引入方式\n\n\`\`\`jsx\nimport ${fileName} from '${fileName}';\n\`\`\`\n\n`;
    if (ts.isInterfaceDeclaration(node)) {
        const { mdContent: content, mockContent } = generateMarkdownForMembers(node, checker);
        mdContent += `## 示例\n\n\`\`\`jsx\n`;
        mdContent += `<${fileName} ${mockContent.trim()}>children</${fileName}>\n`;
        mdContent += `\`\`\`\n\n`;
        mdContent += `## 属性\n\n`;
        mdContent += `| 属性 | 说明 | 类型 | 默认值 |\n| --- | --- | --- | --- |\n`;
        mdContent += content;
    }
    return mdContent;
}
async function generatePropsTable(filePath: string): Promise<string> {
    const program = ts.createProgram([filePath], {});
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(filePath);
    let propsTable = `## 属性\n\n| 属性 | 说明 | 类型 | 默认值 |\n| --- | --- | --- | --- |\n`;

    if (sourceFile) {
        const {importedModule, typeName} = getTypeOfPropsFromDefaultExport(sourceFile);
        if(importedModule && typeName){
            const moduleFilePath = await resolveModuleFilePath(importedModule);
            const program = ts.createProgram([moduleFilePath], {});
            const checker = program.getTypeChecker();
            const importsourceFile = program.getSourceFile(moduleFilePath);
            if(importsourceFile){
                ts.forEachChild(importsourceFile, (node) => {
                    if (ts.isInterfaceDeclaration(node)) {
                        const declarationText = node.getText(sourceFile);
                        console.log('declarationText', declarationText);
                        const { mdContent } = generateMarkdownForMembers(node, checker);
                        propsTable += mdContent;
                    }
                });
            }
            
        }else{
            ts.forEachChild(sourceFile, (node) => {
                if (ts.isInterfaceDeclaration(node) && node.name.text === typeName) {
                    const declarationText = node.getText(sourceFile);
                    console.log('declarationText', declarationText);
                    const { mdContent } = generateMarkdownForMembers(node, checker);
                    propsTable += mdContent;
                }
            });
        }
        
    }
    return propsTable;
}

function generateMarkdownForMembers(node: ts.InterfaceDeclaration, checker: ts.TypeChecker): { mdContent: string, mockContent: string } {
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

    return { mdContent, mockContent };
}

function generateMockValue(type: string): string {
    switch (type) {
        case 'string':
            // 使用Mock生成一个随机的字符串
            return `'${Mock.Random.word()}'`;
        case 'number':
            // 使用Mock生成一个随机的数字
            return `{${Mock.Random?.number?.()}}`;
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
    const text = activeEditor ? activeEditor.document.getText():'';
    const matches = text.match(/\/\*\*\s*\n\s*\*\s*@subtitle\s*(.*?)\s*\n\s*\*\s*@author\s*(.*?)\s*\n/);
    let comment = '';
    if (matches && matches.length > 2) {
        comment = `---
type: Basic
title: ${filename}
subtitle: ${matches[1]}
owner: ${matches[2]}
version: ${version}
---\n\n`;
    } else {
        comment = `---
type: Basic
title: ${filename}
subtitle: 文件名——中文
owner: ${creator}
version: ${version}
---\n\n`;
    }
        // 返回注释
        return comment;
    } catch (error) {
        console.error('Error:', error);
    }
}

// 第二步：查找默认导出的函数声明并获取props参数的类型
function getTypeOfPropsFromDefaultExport (sourceFile: ts.SourceFile):{importedModule?: string,
    typeName?: string} {
    const importedTypes = getImportTypes(sourceFile);
    let result = {};
    // 查找默认导出语句
    const defaultExport = sourceFile.statements.find(statement =>
        ts.isExportAssignment(statement)
    );

     // 检查默认导出是否是一个表达式
     if (defaultExport && ts.isExportAssignment(defaultExport) && defaultExport.expression) {
        let exportExpr = defaultExport.expression;
        // 检查表达式是否是一个标识符，函数声明，函数表达式或箭头函数
        if (ts.isIdentifier(defaultExport.expression)) {
            let exportExpr = defaultExport.expression;
            // 标识符可能是一个变量名或者函数名，所以我们需要检查两种情况
            const symbolDeclaration = sourceFile.statements.find(statement => {
                return (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(decl => decl.name.getText(sourceFile) === exportExpr.text)) ||
                       (ts.isFunctionDeclaration(statement) && statement.name?.text === exportExpr.text);
            });
            
            if (symbolDeclaration) {
                if (ts.isFunctionDeclaration(symbolDeclaration)) {
                    // 这是一个函数声明，我们可以直接获取 props 参数的类型信息
                    symbolDeclaration.parameters.forEach(param => {
                        if (param.name.getText(sourceFile) === 'props' && param.type) {
                            const typeName = param.type.getText(sourceFile);
                            const importedModule = importedTypes[typeName];
                            result = importedModule ? { importedModule, typeName } : { typeName };
                        }
                    });
                } else if (ts.isVariableStatement(symbolDeclaration)) {
                    // 这是一个变量声明，我们需要进一步检查它是否绑定了一个函数表达式或箭头函数
                    symbolDeclaration.declarationList.declarations.forEach(decl => {
                        if (decl.initializer && (ts.isFunctionExpression(decl.initializer) || ts.isArrowFunction(decl.initializer)) && decl.initializer.parameters) {
                            decl.initializer.parameters.forEach(param => {
                                if (param.name.getText(sourceFile) === 'props' && param.type) {
                                    const typeName = param.type.getText(sourceFile);
                                    const importedModule = importedTypes[typeName];
                                    result = importedModule ? { importedModule, typeName } : { typeName };
                                }
                            });
                        }
                    });
                }
            }
            
        } else if (ts.isFunctionDeclaration(exportExpr) || ts.isFunctionExpression(exportExpr) || ts.isArrowFunction(exportExpr)) {
            // 如果是函数声明、函数表达式或箭头函数，则获取params
            const params = exportExpr.parameters;
            params.forEach((param) => {
                if (param.name.getText(sourceFile) === 'props' && param.type) {
                    const typeName = param.type.getText(sourceFile);
                    const importedModule = importedTypes[typeName];
                    if (importedModule) {
                        result = {
                            importedModule,
                            typeName
                        };
                    } else {
                        result = {
                            typeName
                        };
                    }
                }
            });
        }
    }
    return result;
  };

function getImportTypes(sourceFile: ts.SourceFile) {
    // 存储导入信息的映射
    const importedTypes: { [importName: string]: string } = {};
    // 第一步：遍历AST，收集所有的导入类型
    sourceFile.forEachChild((node) => {
        if (ts.isImportDeclaration(node) && node.importClause) {
            const moduleName = node.moduleSpecifier.getText(sourceFile).replace(/["']/g, "");
            const namedBindings = node.importClause.namedBindings;
            if (namedBindings && ts.isNamedImports(namedBindings)) {
                namedBindings.elements.forEach((element) => {
                    const typeName = element.name.getText(sourceFile);
                    importedTypes[typeName] = moduleName;
                });
            } else if (node.importClause.name) {
                const defaultImportName = node.importClause.name.getText(sourceFile);
                importedTypes[defaultImportName] = moduleName;
            }
        }
    });
    return importedTypes;
}

function findRootDir(): string | undefined {
    let path ;
     // 获取当前活动的编辑器
     const activeEditor = vscode.window.activeTextEditor;
        
     if (activeEditor) {
         // 获取当前活动文件的 URI
         const fileUri = activeEditor.document.uri;
         
         // 检查 URI 方案是否是 'file'，这意味着它指向一个文件
         if (fileUri.scheme === 'file') {
             // 获取文件的绝对路径
             path = fileUri.fsPath;
             
             // 输出或使用文件路径
             console.log(path);
             vscode.window.showInformationMessage(`Current file path is: ${path}`);
         }
     } else {
         vscode.window.showInformationMessage('No active editor!');
     }
     return path;
}

// 根据 import 语句解析文件路径
async function resolveModuleFilePath(importPath: string): Promise<string> {
    
    const curimportPath = importPath.split('.')[0];
    // 处理 ajx_modules 路径
    if (curimportPath.startsWith('@')) {

        const moduleNameArr = curimportPath.slice(1).split('/');
        const moduleName = moduleNameArr[0];
        const fileName = moduleNameArr[1];
        const curPath = findRootDir();
        const modulesPath = curPath && findSrcDirectory(curPath, 'ajx_modules');
        const srcPath = modulesPath && path.join(modulesPath, moduleName, 'src');
        const res = srcPath && await findFileInDir(srcPath, new RegExp(`^${fileName}.*`));
        return res ? res :'';
    }else{
        const curPath = findRootDir();
        const srcPath = curPath && findSrcDirectory(curPath, 'src');
        const res = srcPath && await findFileInDir(srcPath, new RegExp(`^${curimportPath}.*`));
        return res ? res : '';
    }
}

function findSrcDirectory(filePath: string, findFile: string) {
    // 获取文件的目录路径
    let dirPath = path.dirname(filePath);

    // 逐级向上检查文件夹是否存在并名为 'src'
    while (dirPath !== path.parse(dirPath).root) {
        // 如果存在名为 'src' 的文件夹，则返回其路径
        if (fs.existsSync(path.join(dirPath, findFile))) {
            return path.join(dirPath, findFile);
        }
        // 向上移动到父目录
        dirPath = path.dirname(dirPath);
    }

    return null; // 如果没有找到 'src' 文件夹，则返回 null
}

async function findFileInDir(startPath: string, filter: RegExp): Promise<string | null> {
    if (!fs.existsSync(startPath) || !fs.statSync(startPath).isDirectory()) {
        console.log("No directory:", startPath);
        return null;
    }

    const filesAndDirs = await fs.promises.readdir(startPath);
    for (const fileOrDir of filesAndDirs) {
        const fullPath = path.join(startPath, fileOrDir);
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
            // 递归检查子目录
            const result = await findFileInDir(fullPath, filter);
            if (result) {
                return result;
            }
        } else if (filter.test(fileOrDir)) {
            // 找到匹配文件，返回路径
            return fullPath;
        }
    }

    return null; // 没有找到符合条件的文件
}