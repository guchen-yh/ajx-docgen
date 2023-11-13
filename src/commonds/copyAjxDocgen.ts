import * as vscode from 'vscode';
import { ajxDocgen } from './ajxDocgen';

export const copyReactDoc = async (file: vscode.Uri) => {
  const componentDocs = await ajxDocgen(file);
  console.log(componentDocs);
};
