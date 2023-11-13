import * as vscode from 'vscode';
import * as docgen from 'react-docgen';

export async function ajxDocgen(file: vscode.Uri) {

  let componentDocs = docgen.parse(file.path);
  if (componentDocs.length <= 1) {
    return componentDocs;
  }

  
  return componentDocs;
}
