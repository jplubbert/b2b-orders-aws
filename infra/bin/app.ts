import { App } from 'aws-cdk-lib';
import { PedidosStack } from '../lib/pedidos-stack.js';

const app = new App();
const stage = String(app.node.tryGetContext('stage') ?? 'dev');
const region = String(app.node.tryGetContext('region') ?? 'us-east-1'); // R-04

new PedidosStack(app, `PedidosB2B-${stage}`, {
  stage,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});
