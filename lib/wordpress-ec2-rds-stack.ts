import * as cdk from '@aws-cdk/core'
import { CustomVPC } from './constructs/vpc'
import { MySQLRdsInstance } from './constructs/rds'
import { WordpressAutoScalingGroup } from './constructs/ec2'
import { WordpressApplicationLoadBalancer } from './constructs/alb'
import { config } from './config'

export class WordpressEc2RdsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)
    // The code that defines your stack goes here

    // VPC -- fetch the custom VPC
    const customVPC = new CustomVPC(this, {
      prefix: config.projectName,
      cidr: '172.22.0.0/16',
    })

    // RDS -- create the mysql database
    new MySQLRdsInstance(this, {
      prefix: config.projectName,
      vpc: customVPC.vpc,
      user: 'wordpress_admin',
      database: 'awesome-wp-site-db',
      port: 3306,
      // DB credentials will be saved under this pathname in AWS Secrets Manager
      secretName: `${config.projectName}/rds/mysql/credentials`, // secret pathname
    })

    // Application Loadbalancer -- for our single instance
    const { loadBalancerDnsName, listener } = new WordpressApplicationLoadBalancer(this, {
      prefix: config.projectName,
      vpc: customVPC.vpc,
    })

    // EC2 -- create the Wordpress instance in an autoscaling group
    const { asg } = new WordpressAutoScalingGroup(this, {
      prefix: config.projectName,
      vpc: customVPC.vpc,
      dnsName: loadBalancerDnsName,
      dbSecretName: `${config.projectName}/rds/mysql/credentials`,
      wpSecretName: `${config.projectName}/wordpress/admin/credentials`,
    })

    // lets add our autoscaling group to our load balancer
    listener.addTargets(`${config.projectName}-wp-asg-targets`, {
      port: 80,
      targets: [asg]
    })
  }
}
