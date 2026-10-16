import {parentPort,workerData} from 'node:worker_threads';
import {parseFile} from './bordero-parser.mjs';
try{parentPort.postMessage({data:await parseFile(Buffer.from(workerData.bytes),workerData.name)});}catch(e){parentPort.postMessage({error:e.message});}
