#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { WordpressEc2RdsStack } from '../lib/wordpress-ec2-rds-stack';
import { config } from '../lib/config';

const app = new cdk.App();
new WordpressEc2RdsStack(app, 'WordpressEc2RdsStack', {
  env: config.env,
  description: 'Deploys resources for RDS and S3 powered Wordpress Infrastructure',
  tags: { Project: config.projectName, Deployedby: config.deployedBy } 
});
