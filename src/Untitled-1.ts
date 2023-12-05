import * as path from 'path';
import * as fs from 'fs';

// 递归函数来查找文件夹中的特定文件
function findRootDir(dir: string, fileToFind: string): string {
    // 检查当前目录中是否存在指定的文件
    if (fs.existsSync(path.join(dir, fileToFind))) {
        // 如果找到了，返回当前目录作为根目录
        return dir;
    }

    // 获取父目录
    const parentDir = path.dirname(dir);

    // 如果已经到达了文件系统的根目录，则停止
    if (dir === parentDir) {
        throw new Error(`${fileToFind} not found in any parent directories`);
    }

    // 向上递归
    return findRootDir(parentDir, fileToFind);
}

// 调用函数来找到项目根目录
const projectRootDir = findRootDir(path.dirname(__dirname), 'package.json');

console.log('Project root directory:', projectRootDir);