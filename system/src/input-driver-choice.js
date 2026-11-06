import fs from 'node:fs';
import path from 'node:path';

export function readInputDriverPreferences(root){
  try{
    const value=JSON.parse(fs.readFileSync(path.join(root,'.local/input-driver-choice.json'),'utf8'));
    if(typeof value.hidHide==='boolean' && typeof value.interception==='boolean')return {hidHide:value.hidHide,interception:value.interception};
    if(['install','skip'].includes(value.choice))return {hidHide:value.choice==='install',interception:value.choice==='install'};
    return null;
  }catch{return null;}
}

export function readInputDriverChoice(root){const value=readInputDriverPreferences(root);return value?(value.hidHide || value.interception?'install':'skip'):null;}
