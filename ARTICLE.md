- [Introduction](#introduction)
- [Abbreviations](#abbreviations)
- [Setup](#setup)
	- [Setup AWS configuration and CDK](#setup-aws-configuration-and-cdk)
	- [Create a new project](#create-a-new-project)
	- [Project structure](#project-structure)
	- [Config](#config)
- [VPC](#vpc)
	- [Setup](#setup-1)
- [RDS](#rds)
	- [Setup](#setup-2)
- [Application Load Balancer](#application-load-balancer)
	- [Important Load Balancer concepts](#important-load-balancer-concepts)
	- [Setup](#setup-3)
- [EC2 via Autoscaling Group](#ec2-via-autoscaling-group)
	- [Setup](#setup-4)
	- [User script](#user-script)
	- [EC2 instance in ASG](#ec2-instance-in-asg)
- [Deployment](#deployment)
	- [Local machine](#local-machine)
	- [Github Actions](#github-actions)
	- [Destroying the stack](#destroying-the-stack)
- [Final result](#final-result)
- [Conclusion](#conclusion)
	- [Debugging](#debugging)
	- [Homework Assignments](#homework-assignments)

# Introduction

Hot off the heels (more than one month ago lol) of the last post, we're going to provision better infrastructure for our Wordpress powered website using the AWS CDK!

In this tutorial, you will learn how to:
- setup a Wordpress EC2 instance in an Autoscaling Group (ASG) that is attached to an Application Load Balancer (ALB)
- setup AWS RDSMySQL database using the CDK
- place your RDS MySQL database in an isolated subnet in a custom VPC for better security
- SSH into the Wordpress instance using AWS SSM and IAM credentials
- add CI/CD to your deployment so that you can deploy to multiple environments via Github actions

All of this will be done in the CDK without needing you to even open the AWS web console. How awesome is that?

Alright, let's go!

# Abbreviations

I may use certain abbreviations throughout this tutorial. When using AWS generally, these abbreviations are quite common due to the insanely verbose names AWS gives its services
- ALB - [Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)
- ASG - [AutoScaling Group](https://docs.aws.amazon.com/autoscaling/ec2/userguide/AutoScalingGroup.html)
- AWS SM - [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/)
- GA - [Github Actions](https://github.com/features/actions)


# Setup

## Setup AWS configuration and CDK
- As usual, you're going to have to ensure you have your AWS dev environment set up (crendentials and config). 
- See [Awesome AWS CDK - Part 2 - Setting up AWS CDK](https://dev.to/emmanuelnk/awesome-aws-cdk-part-2-setting-up-aws-cdk-3ggj) for how to do this.

## Create a new project
- Make a new directory and init a new TS project:
	```bash
	mkdir wordpress-ec2-rds && cd wordpress-ec2-rds
	cdk init --language typescript
	```
- **NOTE:** Sometimes it so happens that the `cdk init` installs an old verison of `cdk-core`. A version mismatch between `@aws-cdk/core` and `@aws-cdk/aws-SOME_SERVICE` can cause errors in Typescript. 
- If you get any weird TS errors while writing CDK code, try checking `package.json` to ensure you're using the latest version of `@aws-cdk/core` and that that version matches exactly with other CDK packages e.g. below `aws-core` and other `aws-cdk` packages are all on version `1.102.0`

	```json
		// package.json
		
		"dependencies":  {
			"@aws-cdk/aws-ec2":  "^1.102.0",
			"@aws-cdk/aws-rds":  "^1.102.0",
			"@aws-cdk/aws-secretsmanager":  "^1.102.0",
			"@aws-cdk/core":  "^1.102.0",
			"dotenv":  "^8.4.0",
			"source-map-support":  "^0.5.16"
		}
	```
	
- To be on the safe side, everytime you start a new CDK project, just run:
	```bash
	npm install @aws-cdk/core@latest
	```

## Project structure
In the last tutorial, we put all of our infrastructure in one file. This is fine if you're provisioning a few resources. However it's always better to split your resources logically into different files to make the project easier to manage. 

This time, we will create a folder called constructs (a construct is just a particular class that is created from a base service class) i.e. we will then create the following files: 
```bash
	mkdir lib/constructs
	touch lib/constructs/ec2.ts
	touch lib/constructs/alb.ts
	touch lib/constructs/rds.ts
	touch lib/constructs/vpc.ts
	touch lib/config.ts
	touch .env
```
where each construct file will contains a specfic AWS service. These constructs will then be imported into the base infrastructure file that the CDK created for us (`lib/wordpress-ec2-rds-stack.ts`)

We also create a `config.ts` file to hold our configurations and a `.env` file to contain our envrionment variables.

(Optional) add a CI file for Github Actions. At the end of the tutorial I will show you how to deploy to either or both `prod` and `dev` using Github Actions
```bash
	mkdir -p .github/workflows/deploy.yml
```

These are thus the files we will concentrate on:
```bash
├── bin
│   └── wordpress-ec2-rds.ts       # entry file
├── lib
│   ├── config.ts                  # stack and account config
│   ├── constructs
│   │   └── ec2.ts
│   │   └── rds.ts
│   │   └── alb.ts
│   │   └── vpc.ts
│   └── wordpress-ec2-rds-stack.ts # where we import the constructs
├── test
│   └── wordpress-ec2-rds.test.ts  # where we test our infrastructure
├── .github
│   ├── workflows
│   │   └── deploy.yml             # CI/CD config file (Github Actions)
└── .env                           # environment variables
```
## Config
- Let's install some required dependencies first
	```
	npm install dotenv
	```
- Let's write our configuration file (`lib/config.ts`):
	```ts
	// lib/config.ts
	import  *  as  dotenv  from  'dotenv'

	// load our environment variables from .env
	dotenv.config()

	// this will be used in resource names
	const  stage  =  process.env.STAGE  ||  'dev'

	export  const  config  =  {
	    // we'll use this prefix to help name our provisioned resources
		projectName:  `wordpress-ec2-rds-${stage}`,
		stage,
		stack:  {
			account:  process.env.AWS_ACCOUNT_NUMBER,
			region:  process.env.AWS_REGION  ||  'us-west-2'
		},
		deployedBy:  process.env.DEPLOYED_BY  ||  process.env.USER,
	}
	```
- Let's create our `.env` file. The variables below are used to aid deployment from localhost as you will see later.
	```
	STAGE=dev
	AWS_ACCOUNT_NUMBER=XXXXXXXXXXXXX
	AWS_REGION=us-west-2
	DEPLOYED_BY=john.doe
	```
- Let's modify our entry file (`bin/wordpress-ec2-rds.ts`) from this
	```ts
	// bin/wordpress-ec2-rds.ts
	#!/usr/bin/env node
	import  'source-map-support/register';
	import  *  as  cdk  from  '@aws-cdk/core';
	import  {  WordpressEc2RdsStack  }  from  '../lib/wordpress-ec2-rds-stack';

	const  app  =  new  cdk.App();

	new  WordpressEc2RdsStack(app,  'WordpressEc2RdsStack',  {

	/* If you don't specify 'env', this stack will be environment-agnostic.
	* Account/Region-dependent features and context lookups will not work,
	* but a single synthesized template can be deployed anywhere. */

	/* Uncomment the next line to specialize this stack for the AWS Account
	* and Region that are implied by the current CLI configuration. */

	// env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

	/* Uncomment the next line if you know exactly what Account and Region you
	* want to deploy the stack to. */
	// env: { account: '123456789012', region: 'us-east-1' },

	/* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
	});
	```
- to this:
	```ts
	// bin/wordpress-ec2-rds.ts
	import  'source-map-support/register';
	import  *  as  cdk  from  '@aws-cdk/core';
	import  {  WordpressEc2RdsStack  }  from  '../lib/wordpress-ec2-rds-stack';
	import  {  config  }  from  '../lib/config';

	const  app  =  new  cdk.App();

	new  WordpressEc2RdsStack(app,  'WordpressEc2RdsStack',  {
		env:  config.env,
		description:  'Deploys resources for RDS and S3 powered Wordpress infrastructure',
		tags:  {  Project:  config.projectName,  Deployedby:  config.deployedBy  }
	});
	```
- **Note:** It's very important to let the CDK know what account and region you will deploy the stack to. This is why we explicitly set the `env` object (which contains `account` and `region` from your environment variables)

Our configuration files and entry files are nopw mostly set up. Let's get to creating our construct files.

# VPC
In short, a VPC (Virtual Private Cloud) is virtual local network (VLAN) that you create on your cloud service provider. You can then add resources to this network and rest assured this network is separated (isolated) from other people's resources on the cloud provider. This has many advantages, the biggest one being security. 

A VPC, essentially being a virtual LAN looks like this: `172.25.0.0/16`. To understand what I just wrote, its important to understand:
- [network addresses, host addresses, subnet masks](https://www.computernetworkingnotes.com/ip-tutorials/ip-address-network-address-and-host-address-explained.html) 
- [CIDR - Classless Inter-Domain Routing](https://www.keycdn.com/support/what-is-cidr)

Additionally, [here is a great explanation from Amazon on VPCs](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Subnets.html).
## Setup
- `mkdir -p lib/constructs/vpc.ts`
- You can either create a new VPC or import an existing one.
- Since I do not have a VPC with isolated subnets, I will create a new VPC
- We need to install the `ec2` cdk module to get access to VPC creation functions
	```bash
	npm install @aws-cdk/aws-ec2
	```
- Here we create the new VPC
	```ts
	// lib/constructs/vpc.ts

	import * as cdk from '@aws-cdk/core'
	import * as ec2 from '@aws-cdk/aws-ec2'

	interface StackProps {
	  prefix: string
	  cidr: string
	}

	/**
	 * Creates a new custom VPC
	 *
	 * @param  {cdk.Construct} scope stack application scope
	 * @param  {StackProps} props props needed to create the resource
	 *
	 */
	export class CustomVPC {
	  // we export the vpc we just created so other resources can use it
	  public readonly vpc: ec2.IVpc

	  constructor(scope: cdk.Construct, props: StackProps) {
	    this.vpc = new ec2.Vpc(scope, `${props.prefix}-vpc`, {
	      maxAzs: 2, // RDS requires at least 2 availability zones
	      cidr: props.cidr, // the ip address block of the vpc e.g. '172.22.0.0/16'
	      enableDnsHostnames: true,
	      enableDnsSupport: true,
	      // expensive -- we don't need that yet (we have no PRIVATE subnets)
	      natGateways: 0, 
	      subnetConfiguration: [
	        {
	          cidrMask: 22,
	          name: `${props.prefix}-public-`,
	          subnetType: ec2.SubnetType.PUBLIC, // for WP instance
	        },
	        {
	          cidrMask: 22,
	          name: `${props.prefix}-isolated-`,
	          subnetType: ec2.SubnetType.ISOLATED, // for RDS DB
	        },
	      ],
	    })
	  }
	}
	```

- Here it's important to note that `scope` represents the base infrastructure class constructor that the new DefaultVPC instance will be created in. It comes from `lib/wordpress-ec2-rds-stack.ts`
- Thus let's fetch our custom VPC inside the `lib/wordpress-ec2-rds-stack.ts` contructor.
- Change `lib/wordpress-ec2-rds-stack.ts` from:
	```ts
	// lib/wordpress-ec2-rds-stack.ts
	
	import  *  as  cdk  from  '@aws-cdk/core';

	export  class  WordpressEc2RdsStack  extends  cdk.Stack  {
		constructor(scope:  cdk.Construct,  id:  string,  props?:  cdk.StackProps)  {
			super(scope,  id,  props);
			// The code that defines your stack goes here

		}
	}
	```
- to this:
	```ts
	// lib/wordpress-ec2-rds-stack.ts
	
	import  *  as  cdk  from  '@aws-cdk/core';
	import  {  CustomVPC  }  from  './constructs/vpc'

	export  class  WordpressEc2RdsStack  extends  cdk.Stack  {
		constructor(scope:  cdk.Construct,  id:  string,  props?:  cdk.StackProps)  {
			super(scope,  id,  props);
			// The code that defines your stack goes here
			
			// VPC -- fetch the custom VPC
			const  customVPC  =  new  CustomVPC(this,  {
				prefix:  config.projectName,
				cidr:  '172.22.0.0/16',
			})
		}
	}
	```
- If you're not sure about what all these configurations mean, you can read more about configuring VPCs in AWS in this [tutorial](https://www.simplilearn.com/tutorials/aws-tutorial/aws-vpc)
- The important takeaway for this tutorial is that your custom VPC has both PUBLIC and ISOLATED (or PRIVATE) subnets


# RDS
From the horse's [mouth](https://aws.amazon.com/rds/):
> Amazon Relational Database Service (Amazon RDS) makes it easy to set up, operate, and scale a relational database in the cloud. It provides cost-efficient and resizable capacity while automating time-consuming administration tasks such as hardware provisioning, database setup, patching and backups. It frees you to focus on your applications so you can give them the fast performance, high availability, security and compatibility they need.
> 
> Amazon RDS is available on several  [database instance types](https://aws.amazon.com/rds/instance-types/)  - optimized for memory, performance or I/O - and provides you with six familiar database engines to choose from, including  [Amazon Aurora](https://aws.amazon.com/rds/aurora/),  [PostgreSQL](https://aws.amazon.com/rds/postgresql/),  [MySQL](https://aws.amazon.com/rds/mysql/), [MariaDB](https://aws.amazon.com/rds/mariadb/),  [Oracle Database](https://aws.amazon.com/rds/oracle/), and [SQL Server](https://aws.amazon.com/rds/sqlserver/). You can use the  [AWS Database Migration Service](https://aws.amazon.com/dms/)  to easily migrate or replicate your existing databases to Amazon RDS.

In the last tutorial, we installed and ran the MySQL database on the same instance running Wordpress. You usually want to have your database on a separate (and managed) instance so that you can easily configure it, scale or resize it, back it up, secure it behind a private subnet etc AWS RDS is thus perfect for our use case

## Setup
- Create the cdk construct file
	```bash
	mkdir -p lib/constructs/rds.ts
	```
- Let's install the cdk modules that we need
	```bash
	npm install @aws-cdk/aws-rds @aws-cdk/aws-secretsmanager
	```
- Let's import what we need
	```ts
	// lib/constructs/rds.ts

	import * as cdk from '@aws-cdk/core'
	import * as ec2 from '@aws-cdk/aws-ec2'
	import * as rds from '@aws-cdk/aws-rds'

	// this is where we will keep our database credentials e.g. user, password, host etc
	import * as secrets from '@aws-cdk/aws-secretsmanager'
	```

- Since the RDS construct is initialized from the base infrastructure class, when we create a new instance we can pass some needed properties
- For example, we need to know the vpc we want to use, the database port or user we would like to use, the name of the secret in secretsmanager that will keep our db secrets etc
	```ts
	interface StackProps {
	  // this is useful when deploying to multiple environments e.g. prod, dev
	  prefix: string
	  vpc: ec2.Vpc
	  user: string
	  port: number
	  database: string
	  secretName: string
	}

	/**
	 * Creates a MySQL DB on AWS RDS
	 * 
	 * @param  {cdk.Construct} scope stack application scope
	 * @param  {StackProps} props props needed to create the resource
	 * 
	 */
	export class MySQLRdsInstance {
	  public readonly databaseSecretName: string

	  constructor(scope: cdk.Construct, props: StackProps){
	    // this is where all the following code will go
	  }
	}
	```
Eveything that follows is inside the constructor of `MySQLRdsInstance` i.e. right below the `// this is where all the following code will go` comment:
- Let's get our vpc from the props we just created
	```ts
	    // use the vpc we expoted from lib/constructs/vpc.ts
	    const customVPC = props.vpc
	```
- Create a security group to allow connections only from inside the vpc
	```ts
	    // create the security group for RDS instance
	    const ingressSecurityGroup = new ec2.SecurityGroup(scope, `${props.prefix}-rds-ingress`,{ 
	        vpc: customVPC,
	        securityGroupName: `${props.prefix}-rds-ingress-sg`,
	      })

	    ingressSecurityGroup.addIngressRule(
	      // defaultVPC.vpcCidrBlock refers to all the IP addresses in defaultVPC
	      ec2.Peer.ipv4(defaultVPC.vpcCidrBlock),
	      ec2.Port.tcp(props.port || 3306),
	      'Allows only local resources inside VPC to access this MySQL port (default -- 3306)'
	    )
	```
- Generate the database secrets using Secrets Manager
	```ts
	    // Dynamically generate the username and password, then store in secrets manager
	    const databaseCredentialsSecret = new secrets.Secret(
	      scope,
	     `${props.prefix}-MySQLCredentialsSecret`,
	      {
	        secretName: props.secretName,
	        description: 'Credentials to access Wordpress MYSQL Database on RDS',
	        generateSecretString: {
	          secretStringTemplate: JSON.stringify({ username: props.user }),
	          excludePunctuation: true,
	          includeSpace: false,
	          generateStringKey: 'password',
	        },
	      }
	    )
	```
- Now let's create our RDS MySQL instance
	```ts
	    const mysqlRDSInstance = new rds.DatabaseInstance(scope, `${props.prefix}-MySqlRDSInstance`, {
	      credentials: rds.Credentials.fromSecret(databaseCredentialsSecret),
	      engine: rds.DatabaseInstanceEngine.mysql({
	        version: rds.MysqlEngineVersion.VER_5_7_31
	      }),
	      port: props.port,
	      allocatedStorage: 100,
	      storageType: rds.StorageType.GP2,
	      backupRetention: cdk.Duration.days(7),
	      // t2.micro is free tier so we use it  
	      instanceType: ec2.InstanceType.of(
	        ec2.InstanceClass.T2,
	        ec2.InstanceSize.MICRO
	      ),
	      vpc: customVPC,
	      // we chose to place our database in an isolated subnet of our VPC
	      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
	      // if we destroy our database, AWS will take a snapshot of the database instance before terminating it
	      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
	      // accidental deletion protection -- you need to manually disable this in AWS web console to delete the database
	      deletionProtection: true,
	      securityGroups: [ingressSecurityGroup],
	    })
	```
- View the final file [here]()


- Then let's import the RDS construct in our `lib/wordpress-ec2-rds-stack.ts` file:
	```ts
		// lib/wordpress-ec2-rds-stack.ts
		import * as cdk from '@aws-cdk/core';
		import { DefaultVPC } from './constructs/vpc'
		import { MySQLRdsInstance } from './constructs/rds'
		import { config } from './config'

		export class WordpressEc2RdsStack extends cdk.Stack {
			constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
				super(scope, id, props);

				// The code that defines your stack goes here

				// VPC -- fetch the default VPC
				const defaultVPC = new DefaultVPC(this)

				// RDS -- create the mysql database
				new MySQLRdsInstance(this, {
					prefix: config.projectName,
					vpc: defaultVPC.vpc, // deploy the database in the default VPC!
					user: 'wordpress_admin',
					database: 'awesome-wp-site-db',
					port: 3306,
					// DB credentials will be saved under this pathname in AWS Secrets Manager
					secretName: `${config.projectName}/rds/mysql/credentials`, // secret pathname
				})
			}
		}
	```
	
# Application Load Balancer
From the horse's [mouth](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html):
> Elastic Load Balancing automatically distributes your incoming traffic across multiple targets, such as EC2 instances, containers, and IP addresses, in one or more Availability Zones. It monitors the health of its registered targets, and routes traffic only to the healthy targets. Elastic Load Balancing scales your load balancer as your incoming traffic changes over time. It can automatically scale to the vast majority of workloads.
> Elastic Load Balancing supports the following load balancers: Application Load Balancers (ALBs), Network Load Balancers (NLBs), Gateway Load Balancers (GLBs), and Classic Load Balancers (CLBs).

## Important Load Balancer concepts
- A  _load balancer_  serves as the single point of contact for clients. The load balancer distributes incoming application traffic across multiple targets, such as EC2 instances, in multiple Availability Zones. This increases the availability of your application. You add one or more listeners to your load balancer.
- A  _listener_  checks for connection requests from clients, using the protocol and port that you configure. The rules that you define for a listener determine how the load balancer routes requests to its registered targets. Each rule consists of a priority, one or more actions, and one or more conditions. When the conditions for a rule are met, then its actions are performed. You must define a default rule for each listener, and you can optionally define additional rules.
- Each  _target group_  routes requests to one or more registered targets, such as EC2 instances, using the protocol and port number that you specify. You can register a target with multiple target groups. You can configure health checks on a per target group basis. Health checks are performed on all targets registered to a target group that is specified in a listener rule for your load balancer.

## Setup
- For this tutorial we will be setting up an ALB.
- You can read about the difference between ALB, NLB and CLB [here](https://medium.com/awesome-cloud/aws-difference-between-application-load-balancer-and-network-load-balancer-cb8b6cd296a4)
- Create a new file to define the ALB in and install required CDK dependency
	```bash
	touch lib/constructs/alb.ts
	npm install @aws-cdk/aws-elasticloadbalancingv2
	```
-  In the newly created file:
```ts
// lib/constructs/alb.ts

import * as cdk from '@aws-cdk/core'
import * as ec2 from '@aws-cdk/aws-ec2'
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2'

interface StackProps {
  prefix: string
  vpc: ec2.IVpc
}

/**
 * Creates an Application Load Balancer for our Wordpress stack
 *
 * @param  {cdk.Construct} scope stack application scope
 * @param  {StackProps} props props needed to create the resource
 *
 */
export class WordpressApplicationLoadBalancer {
  // export the DNS name of the load balancer for WP install 
  public readonly loadBalancerDnsName: string
  // export ALB listener so we can attach autoscaling group
  listener: elbv2.IApplicationListener

  constructor(scope: cdk.Construct, props: StackProps) {
    const alb = new elbv2.ApplicationLoadBalancer(
      scope,
      `${props.prefix}-alb`,
      {
        loadBalancerName: `${props.prefix}-alb`,
        vpc: props.vpc,
        internetFacing: true,
      }
    )

    // we need to expose the dns name of the load balancer
    // so we can use it when installing Wordpress later
    this.loadBalancerDnsName = alb.loadBalancerDnsName

    // we will  need the listener to add our autoscaling group later
    this.listener = alb.addListener(`${props.prefix}-alb-listener`, {
      port: 80,
      open: true,
    })

    // print out the dns name of the alb
    new cdk.CfnOutput(scope, `${props.prefix}-alb-dns-name`, {
      value: alb.loadBalancerDnsName,
    })
  }
}
```
Then let’s import the ALB construct in our `lib/wordpress-ec2-rds-stack.ts` file:
```ts
// lib/wordpress-ec2-rds-stack.ts
import * as cdk from '@aws-cdk/core';
import { DefaultVPC } from './constructs/vpc'
import { MySQLRdsInstance } from './constructs/rds'
import { WordpressApplicationLoadBalancer } from './constructs/alb'
import { config } from './config'

export class WordpressEc2RdsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // VPC -- fetch the default VPC
    const defaultVPC = new DefaultVPC(this)

    // RDS -- create the mysql database
    new MySQLRdsInstance(this, {
      prefix: config.projectName,
      vpc: defaultVPC.vpc, // deploy the database in the default VPC!
      user: 'wordpress_admin',
      database: 'awesome-wp-site-db',
      port: 3306,
      // DB credentials will be saved under this pathname in AWS Secrets Manager
      secretName: `${config.projectName}/rds/mysql/credentials`, // secret pathname
    })

    // ALB -- for our single instance
    const { loadBalancerDnsName, listener } = new WordpressApplicationLoadBalancer(this, {
      prefix: config.projectName,
      vpc: customVPC.vpc,
    })
  }
}
```


# EC2 via Autoscaling Group
In the last tutorial, we used the CDK to launch a single EC2 instance. This time, we will do the same thing, however, we will launch the instance using an ASG. 

From the horse's [mouth](https://docs.aws.amazon.com/autoscaling/ec2/userguide/AutoScalingGroup.html):

> An  _Auto Scaling group_  contains a collection of Amazon EC2 instances that are treated as a logical grouping for the purposes of automatic scaling and management. An Auto Scaling group also enables you to use Amazon EC2 Auto Scaling features such as health check replacements and scaling policies. Both maintaining the number of instances in an Auto Scaling group and automatic scaling are the core functionality of the Amazon EC2 Auto Scaling service.
> 
> The size of an Auto Scaling group depends on the number of instances that you set as the desired capacity. You can adjust its size to meet demand, either manually or by using automatic scaling.
> 
> An Auto Scaling group starts by launching enough instances to meet its desired capacity. It maintains this number of instances by performing periodic health checks on the instances in the group. The Auto Scaling group continues to maintain a fixed number of instances even if an instance becomes unhealthy. If an instance becomes unhealthy, the group terminates the unhealthy instance and launches another instance to replace it. For more information, see  [Health checks for Auto Scaling instances](https://docs.aws.amazon.com/autoscaling/ec2/userguide/healthcheck.html).

- In our use case, we will use just one instance. This is because Wordpress is installed to the volume attached to this singular instance. If we launched more than two instances, then we would be redirecting users to two seperate WP installations (that may end up having different uploaded content, plugins etc because these files are installed to the file volumes).
- This is desirable in certain cases e.g. if you want to serve users in different geographic regions different website content (without changing the url).
- For most users however, the main use case of autoscaling is to spread server load horizonatally across instances. 
- A work-around that I did not implement in this tutorial is to sync uploaded content to S3 and use a shared EFS file system for the wordpress installation (something which I may look at in detail in another tutorial or at the ednof this one)
- *What then is the purpose of using an ASG with just one desired instance?* Good question. For this tutorial, it is mostly used to warm you up to the concept of using ASGs and Load Balancers. In later tutorials, I will write applications that are better at utilizing ASGs than Wordpress. Also, if you instance should get accidentally terminated somehow, the ASG will immediately spin up another one. Awesome!

  
## Setup
- Create the file to hold our EC2 constructs and install dependecies
	```bash
	touch lib/constructs/ec2/ts
	npm install @aws-cdk/aws-secretsmanager @aws-cdk/aws-autoscaling
	```
- This time, instead of using an SSH key, we will use `aws-ssm` and IAM to access our instances via SSH
- We will place our instance in an autoscaling group with a maximum and minimum capacity of 1
- We are also going to define a helper function to help do some string replacement later on. We will be using this function to insert envrionment secrets into our user script.
- `touch lib/utils.ts`
	```ts
	// lib/utils.ts
	
	/**
	 * Replaces all given substring in a text with new substring e.g.
	 *
	 * @example
	 *  const text = 'The woman and man and woman and man'
	 *  const wordsArray = [{ man: 'boy' }, { woman: 'girl' }]
	 *
	 *  console.log(replaceAllSubstrings(wordsArray, text))
	 *  // The girl and boy and girl and boy
	 *
	 * @param  {Array<Record<string, string>>} wordsArray the words to be substituted and the words to substitute them with
	 * @param  {string} text the text from which to substitute the given sub strings
	 * @returns the altered text
	 */
	export const replaceAllSubstrings = (
	  wordsArray: Array<Record<string, string>>,
	  text: string
	) =>
	  wordsArray.reduce(
	    (f, s) =>
	      `${f}`.replace(new RegExp(Object.keys(s)[0], 'g'), s[Object.keys(s)[0]]),
	    text
	  )
	```
- Inside `lib/constructs/ec2.ts`, we start by getting our imports
	```ts
	import  *  as  fs  from  'fs'
	import  *  as  cdk  from  '@aws-cdk/core'
	import  *  as  ec2  from  '@aws-cdk/aws-ec2'
	import  *  as  secrets  from  '@aws-cdk/aws-secretsmanager'
	import  *  as  autoscaling  from  '@aws-cdk/aws-autoscaling'
	import  *  as  iam  from  '@aws-cdk/aws-iam'
	import  {  config  }  from  '../config'
	import  {  replaceAllSubstrings  }  from  '../utils'
	```
- We then define the `props` for the EC2 instance class we are defining
	```ts
	interface  StackProps  {
		prefix:  string
		vpc:  ec2.IVpc
		/* the dns name of the ALB */
		dnsName:  string
	    /* the path of the db access secret in AWS SM */
	    dbSecretName: string 
	    /* the path of the wp admin secret in AWS SM */
	    wpSecretName: string
	}
	```
- We then define a new class to hold our construct code
	```ts
	/**
	 * Creates the Wordpress EC2 AutoscalingGroup
	 *
	 * @param  {cdk.Construct} scope stack application scope
	 * @param  {StackProps} props props needed to create the resource
	 *
	 */
	export class WordpressAutoScalingGroup {
	  // export our newly created instance
	  public readonly asg: autoscaling.AutoScalingGroup

	  constructor(scope: cdk.Construct, props: StackProps) {
		// all the code will go here
	  }
	}
	```
- Inside the constructor, we can start by importing the custom vpc, defining a role for ur ec2 instance and creating the necessary security groups:
	```ts
	    // use the vpc we just created
	    const customVPC = props.vpc

	    // define a role for the wordpress instances
	    const role = new iam.Role(scope, `${props.prefix}-instance-role`, {
	      assumedBy: new iam.CompositePrincipal(
	        new iam.ServicePrincipal('ec2.amazonaws.com'),
	        new iam.ServicePrincipal('ssm.amazonaws.com')
	      ),
	      managedPolicies: [
	        // allows us to access instance via SSH using IAM and SSM
	        iam.ManagedPolicy.fromAwsManagedPolicyName(
	          'AmazonSSMManagedInstanceCore'
	        ),
	        // allows ec2 instance to access secrets maanger and retrieve secrets
	        iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
	      ],
	    })

	    // lets create a security group for the wordpress instance
	    const securityGroup = new ec2.SecurityGroup(
	      scope,
	      'wordpress-instances-sg',
	      {
	        vpc: customVPC,
	        allowAllOutbound: true,
	        securityGroupName: 'wordpress-instances-sg',
	      }
	    )
	    // NB: the WP instance will not be exposed to the public Internet this time
	    // the Internet can access it through the ALB only
	    // the admin can access it (the console) via SSM
	    securityGroup.addIngressRule(
	      ec2.Peer.ipv4(customVPC.vpcCidrBlock),
	      ec2.Port.tcp(80),
	      'Allows HTTP access from resources inside our VPC (like the ALB)'
	    )
	```

- Since we want to automate the entire installation of WP on our instance, we will need to automate the famous [Wordpress 5 minute install](https://winningwp.com/how-to-install-wordpress-the-famous-five-minute-install-made-simple/) (See step 9 in this article).
- In order to do this, we need to define secrets for our WP Admin
- Inside `lib/config.ts`, we can add a new object `wordpress` to keep some of those secrets:
	```ts
	// lib/config.ts
	...
	...
	export const config = {
	  projectName: `wordpress-ec2-rds-${stage}`, 
	  ...
	  wordpress: {
	    admin: {
	      username: process.env.WP_ADMIN_USER || 'admin',
	      email: process.env.WP_ADMIN_EMAIL || 'admin@whatever.com'
	    },
	    site: {
		  // name of the database WP will use (cannot have hyphens) 
	      databaseName: process.env.WP_DB_NAME || 'awesome_wp_site_db',
	      // the name of our WP  website
	      title: process.env.WP_SITE_TITLE || 'awesome-wp-site',
	      // where we will install WP on our instance volume
	      installPath: process.env.WP_SITE_INSTALL_PATH || '/var/www/html/',
	    }
	  }
	}
	```
- Make sure you add those variables in your `.env` file:
	```
	STAGE=dev
	AWS_ACCOUNT_NUMBER=XXXXXXXXXXXXX
	AWS_REGION=us-west-2
	DEPLOYED_BY=john.doe
		
	# Wordpress Site Variables
	WP_DB_NAME='awesome_wp_site_db'
	WP_SITE_TITLE='awesome_wp_site'
	WP_SITE_INSTALL_PATH=/var/www/html/

	# Wordpress Admin Secrets
	WP_ADMIN_EMAIL=admin@awesomewpsite.com
	WP_ADMIN_USER=admin
	```
- Let's add the code to add our WP admin secrets in AWS SM for Wordpress Admin as well as generate a new WP Admin password inside the `WordpressAutoScalingGroup` constructor 
	```ts
	    ...
	    ...
	    
	    // secrets for wp admin
	    new secrets.Secret(scope, 'WordpressAdminSecrets', {
	      secretName: props.wpSecretName,
	      description: 'Admin credentials to access Wordpress',
	      generateSecretString: {
	        secretStringTemplate: JSON.stringify({
	          username: config.wordpress.admin.username,
	          email: config.wordpress.admin.email,
	        }),
	        // will generate a random password under the object key 'password'
	        generateStringKey: 'password',
	      },
	    })
	```
## User script
- We now need to write our user script to configure Wordpress on our instance and automate the famous 5 minute WP install
- In summary, we need to first install the dependencies (e.g. Apache, PHP and Wordpress etc) on the instance
- Then we need to wait for the RDS MySQL database to initialize and be in a ready state **(very important)**. If the database is not ready, then WP installation will fail because you won't be able to create the necessary tables in the database.
- When the database is ready, we install  Wordpress and that's it!
- Read the comments in the script to understand what's going on
	```bash
	mkdir lib/scripts && touch lib/scripts/wordpress_install.sh
	```

	```bash
	#! /bin/bash

    # lib/scripts/wordpress_install.sh

	#------------------ 0.USEFUL FUNCTIONS

	# Checks to see if an env is defined (not null) in the bash session
	is_defined () {
	    for var in "$@" ; do
	        if [ ! -z "${!var}" ] & [ "${!var}" != "null" ]; then
	            echo "$var is set to ${!var}"
	        else
	            echo "$var is not set"
	            return 1
	        fi
	    done
	}

	# Checks if desired db secrets in secrets manager are ready
	# Db secrets are only fully ready when the RDS DB is ready
	db_secrets_ready () {
	    if ! is_defined "AWS_REGION" "DB_SECRETS_PATH";then
	        return 0
	    fi

	    echo "Retrieving secrets..." 
	    DB_SECRETS_JSON=$(aws secretsmanager get-secret-value --secret-id $DB_SECRETS_PATH --region $AWS_REGION | jq -r '.SecretString')

	    echo "Retrieved secrets." 
	    DB_USER=$(echo $DB_SECRETS_JSON | jq -r '.username')
	    DB_PASS=$(echo $DB_SECRETS_JSON | jq -r '.password')
	    DB_HOST=$(echo $DB_SECRETS_JSON | jq -r '.host')
	    DB_PORT=$(echo $DB_SECRETS_JSON | jq -r '.port')

	    echo "Checking secrets..." 
	    if ! is_defined "DB_USER" "DB_PASS" "DB_HOST" "DB_PORT";then
	        echo "Secrets are not ready." 
	        return 1
	    fi

	    echo "Secrets are ready." 
	    return 0

	}

	#------------------  1.INSTALL DEPENDECIES
	# update dependencies
	yum -y update

	# Install Apache
	yum -y install httpd

	# Start Apache
	service httpd start

	# Install PHP, PHP CLI, JQ, MySQL
	yum -y install php php-cli php-mysql jq mysql mysqladmin

	# PHP7 needed for latest wordpress
	amazon-linux-extras install php7.4 -y 

	# Restart Apache
	service httpd restart

	# Install the Wordpress CLI which will help us install Wordpress correctly
	curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
	chmod +x wp-cli.phar
	mv wp-cli.phar /usr/local/bin/wp

	#------------------  2.SET SCRIPT GLOBAL VARIABLES

	# AWS and Wordpress variables to replace
	# We will replace these variables in the CDK ec2 construct file
	# before using the script to launch an ec2 instance
	DB_SECRETS_PATH=_DB_SECRETS_PATH_
	WP_SECRETS_PATH=_WP_SECRETS_PATH_
	AWS_REGION=_AWS_REGION_
	WP_DB_NAME=_WP_DB_NAME_
	WP_SITE_TITLE=_WP_SITE_TITLE_
	WP_SITE_INSTALL_PATH=_WP_SITE_INSTALL_PATH_
	WP_SITE_BASE_DOMAIN=_WP_SITE_BASE_DOMAIN_

	# Wait for Secrets Manager to have RDS secret ready
	# Certain database secrets (e.g host, port) won't be ready until the database is ready
	echo "Waiting up to 20 minutes for Secrets Manager to be ready with Secrets";
	for i in {1..240}; do
	    echo "try count: $i"
	    db_secrets_ready && break;
	    # retry every 30 seconds
	    sleep 30s; 
	done
	echo "Secrets Manager is ready with Secrets";

	# Use the AWS CLI to get secrets from Secrets Manager
	DB_SECRETS_JSON=$(aws secretsmanager get-secret-value --secret-id $DB_SECRETS_PATH --region $AWS_REGION | jq -r '.SecretString')
	WP_SECRETS_JSON=$(aws secretsmanager get-secret-value --secret-id $WP_SECRETS_PATH --region $AWS_REGION | jq -r '.SecretString')

	# Parse secrets from JSON response using the useful jq
	DB_USER=$(echo $DB_SECRETS_JSON | jq -r '.username')
	DB_PASS=$(echo $DB_SECRETS_JSON | jq -r '.password')
	DB_HOST=$(echo $DB_SECRETS_JSON | jq -r '.host')
	DB_PORT=$(echo $DB_SECRETS_JSON | jq -r '.port')
	WP_ADMIN_USER=$(echo $WP_SECRETS_JSON | jq -r '.username')
	WP_ADMIN_PASSWORD=$(echo $WP_SECRETS_JSON | jq -r '.password')
	WP_ADMIN_EMAIL=$(echo $WP_SECRETS_JSON | jq -r '.email')

	# If some ENV is not defined, stop the script
	if ! is_defined \
	"DB_SECRETS_PATH" \
	"WP_SECRETS_PATH" \
	"AWS_REGION" \
	"WP_DB_NAME" \
	"WP_SITE_TITLE" \
	"WP_SITE_INSTALL_PATH" \
	"WP_SITE_BASE_DOMAIN" \
	"DB_USER" \
	"DB_PASS" \
	"DB_HOST" \
	"DB_PORT" \
	"WP_ADMIN_USER" \
	"WP_ADMIN_PASSWORD" \
	"WP_ADMIN_EMAIL" \
	; then
	    echo "Exiting WP installation script because some variables were undefined"
	    exit 0
	fi

	#------------------  3.CREATE WORDPRESS MYSQL DATABASE

	# Wait for the database to be ready
	# Usually this should only run once because of the DB secrets in AWS SM are ready
	# then it means the database is likely ready as well
	for i in {1..30}; do
	    echo "try count: $i"
	    mysqladmin ping -h "$DB_HOST" -u$DB_USER -p$DB_PASS -P $DB_PORT --silent && break;
	    # retry every 30s
	    sleep 30s
	done

	# Create the database.
	echo "Creating the database $WP_DB_NAME..."
	mysql -h $DB_HOST -u$DB_USER -p$DB_PASS -P $DB_PORT -e"CREATE DATABASE $WP_DB_NAME"

	#------------------  4.SETUP WORDPRESS INSTALLATION

	# Download WP Core.
	/usr/local/bin/wp core download --path=$WP_SITE_INSTALL_PATH

	# Generate the wp-config.php file
	/usr/local/bin/wp core config \
	--path=$WP_SITE_INSTALL_PATH \
	--dbname=$WP_DB_NAME \
	--dbuser=$DB_USER \
	--dbpass=$DB_PASS \
	--dbhost=$DB_HOST \
	--extra-php <<PHP
	define('WP_DEBUG', true);
	define('WP_DEBUG_LOG', true);
	define('WP_DEBUG_DISPLAY', true);
	define('WP_MEMORY_LIMIT', '256M');
	PHP

	# Install the WordPress database.
	/usr/local/bin/wp core install \
	--path=$WP_SITE_INSTALL_PATH \
	--url=$WP_SITE_BASE_DOMAIN \
	--title=$WP_SITE_TITLE \
	--admin_user=$WP_ADMIN_USER \
	--admin_password=$WP_ADMIN_PASSWORD \
	--admin_email=$WP_ADMIN_EMAIL

	# Restart Apache
	service httpd restart

	# Wordpress is now installed!
	```
- If all goes well, when yuo navigate to the loadbalancer DNS name, the wordpress website should just pop up without any need for any configuration 
- Let's now add the user script and insert some required environment variables in the CDK file
- In the `WordpressAutoScalingGroup` constructor
	```ts
	    ...
	    ...
	    
	    // Fetch the user script from file system as a string
	    const userScript = fs.readFileSync(
	      'lib/scripts/wordpress_install.sh',
	      'utf8'
	    )

	    // Replace the following variable substrings in the userScript
	    const modifiedUserScript = replaceAllSubstrings(
	      [
	        { _DB_SECRETS_PATH_: props.dbSecretName },
	        { _WP_SECRETS_PATH_: props.wpSecretName },
	        { _AWS_REGION_: config.env.region },
	        { _WP_DB_NAME_: config.wordpress.site.databaseName },
	        { _WP_SITE_TITLE_: config.wordpress.site.title },
	        { _WP_SITE_INSTALL_PATH_: config.wordpress.site.installPath },
	        { _WP_SITE_BASE_DOMAIN_: props.dnsName }, // our load balancer dns name
	      ],
	      userScript
	    )
	```
## EC2 instance in ASG
- Finally, we can create our ec2 instance in an ASG
	```ts
	...
	...
	// finally create and export out autoscaling group
    this.asg = new autoscaling.AutoScalingGroup(scope, `${props.prefix}-asg`, {
      vpc: customVPC,
      // add the role we created (needs access to AWS SM)
      role,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      // add our modified user script to launch with instances in this ASG
      userData: ec2.UserData.custom(modifiedUserScript),
      // we only want one instance in our ASG
      minCapacity: 1,
      maxCapacity: 1,
      associatePublicIpAddress: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    })
	```
- The final file should look like [this]()

	
- We then need to attach the ASG we just created as a target to the the listener of the ALB we created earlier, using port 80 
- This will redirect all requests for WP at the loadblancer to port 80 of our WP instance.
- Right below the EC2 construct in the  `WordpressEc2RdsStack` constructor, add:
	```ts
	    // lets add our autoscaling group to our load balancer
	    listener.addTargets(`${config.projectName}-wp-asg-targets`, {
	      port: 80,
	      targets: [asg]
	    }) 
	```
- The final `lib/wordpress-ec2-rds-stack.ts` should look like:
	```ts
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
	```
- At this point,  all the resources are ready to be deployed!
# Deployment
## Local machine
- To deploy from your local machine, make sure all your aws credentials and configurations are correctly setup
- Ensure you have the `.env` file with the following environment variables setup:
	```
	STAGE=dev
	AWS_ACCOUNT_NUMBER=XXXXXXXXXXXXXXX
	AWS_REGION=us-west-2
	DEPLOYED_BY=john.doe

	# Wordpress Variables
	WP_DB_NAME='awesome_wp_site_db'
	WP_SITE_TITLE='awesome_wp_site'
	WP_SITE_INSTALL_PATH=/var/www/html/

	# Wordpress Admin Secrets
	WP_ADMIN_EMAIL=admin@awesomewpsite.com
	WP_ADMIN_USER=admin
	```
- You can then first try to synthesize the stack and make sure everything is correct
	```bash
	cdk synth --profile default
	```
- If the CDK outputs a YAML file to the console without any issue, then you can deploy
	```bash
	cdk deploy --profile default
	```
- You will be asked to approve of IAM changes before the deployment can continue

## Github Actions
- Deploying from your local machine is not recommended in a production environment.
- Fortunately, Github provides a free CI/CD service called [Github Actions](https://github.com/features/actions)
- All we have to do in this instance is create a simple YAML configuration file that can help us deploy to different stages using GA (for the purposes of this tutorial, just `dev` and `prod`)
-  From the root of your project
	```bash
	mkdir -p .github/workflows && touch .github/workflows/deploy.yml
	``` 
- Open up `.github/workflows/deploy.yml` and add the following code
	```yaml
	name: Deploy

	on:
	  push:
	    branches:
	      - master
	      - dev
	jobs:
	  deploy:
	    runs-on: ubuntu-latest
	    steps:
	      - name: Checkout repository
	        uses: actions/checkout@v2
	      - uses: nelonoel/branch-name@v1.0.1
	      - name: cdk deploy
	        uses: youyo/aws-cdk-github-actions@v1
	        with:
	          cdk_subcommand: 'deploy'
	          cdk_args: '--require-approval never'
	        env:
	          STAGE: ${{ env.BRANCH_NAME == 'master' && 'prod' || 'dev'  }}
	          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
	          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
	          AWS_DEFAULT_REGION: ${{ secrets.AWS_DEFAULT_REGION }}
	          AWS_ACCOUNT_NUMBER: ${{ secrets.AWS_ACCOUNT_NUMBER }}
	          DEPLOYED_BY: ${{ secrets.DEPLOYED_BY }}
	```
- What's going on?
	- GA will only run this script when a push/merge to the branches `dev` or `master` happens
	- GA will create an Ubuntu container, checkout the repository and run CDK deploy
	- A useful GA action called `branch-name@v1.0.1` gets the name fo the branch we are working on and deploys to the correct stage based on that branch (it sets the `STAGE` env variable)
	- GA action `aws-cdk-github-actions@v1` runs `cdk deploy` and deploys the resources to AWS
- In order for this to work, you have to to go the settings of your repository on Github and add the follwowing secrets:
	- AWS_ACCESS_KEY_ID
	- AWS_SECRET_ACCESS_KEY
	- AWS_DEFAULT_REGION
	- AWS_ACCOUNT_NUMBER
	- DEPLOYED_BY
- For AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, you can create a new user in IAM in the AWS console called `github.actions.bot` that has administrator privileges and only PROGRAMMATIC ACCESS and paste those values in Github settings as secrets

## Destroying the stack
- To destroy the stack from your local machine using the CDK, just run
	```bash
	cdk destroy --profile default
	```
- To destroy the stack from AWS console
	- Log in to the AWS console
	- Go to Cloudformation
	- Find your stack > Destroy/Delete
	- 
# Final result

Whether you deploy from your local machine or via Github actions, if all goes well, after about 20 minutes (RDS databases take a while to initialize) you should see this output:

- In your browser, navigate to the DNS name printed in the output of your local machine console of the GA console.
- Alternatively, you can find the DNS name of the ALB via EC2 console > Load balancers
- You should then see:


# Conclusion
- In this tutorial I tried to keep things simple and did not add many improvements that I would likely add in a real production scenario (See the Homework Assignments section for improvements that can make your WP installation Production ready on AWS)

## Debugging
- To access the ec2 instance your ASG just spn up, you need to get the instance id from the AWS EC2 console
- Once you have the instance id, to log into your instance, just do:
	```bash
	aws ssm start-session --target "i-0191364267ad972a2" --profile default
	```
- where `i-0191364267ad972a2` is the id of the instance as seen in the AWS console. Cool right? No need for SSH keys! 
- Of course, if you still want to use regular SSH then in the CDK you have to open port 22 and create an SSH key pair on your machine and upload the public key to the ec2 instance.
- If Wordpress does not load correctly when you navigate to the ALB DNS name, then it is likely something with the configuration of the database, or access to secrets manager went wrong.
- You can check the user script logs in the ec2 instance
	```bash
	# list all log files related to ec2 start up scripts
	find / -name "*cloud*log"
	```

## Homework Assignments
There are many improvements you can make to this CDK stack to make a better WP installation. I'll leave them as homework
- Create an S3 bucket using the CDK and use this [Wordpress plugin](https://github.com/humanmade/S3-Uploads) to sync Wordpress uploads to AWS S3. *Hint: You install this plugin via the user script.*
- Use the CDK to create an [EFS filesystem](https://aws.amazon.com/efs/) to install Wordpress to instead of installing Wordpress to `var/www/html` on the default attached volume (which limits WP to one instance). The key here is the same EFS filesystem can be used by many instances. 
- The above two improvements combined will allow you to use more than one instance in the WP ASG and make your Wordpress Installation much more highly available and resilient.
- Create a cloudfront distribution to serve the WP content from the S3 bucket you just created
- Buy a cheap 5 dollar `.link` domain on AWS Route53 and use it in the CDK instead of the ALB dnsName.  That way, your site can be accessed via something like `mywebsite.link`
- Add `CloudWatchAgentServerPolicy` to Wordpress instance role and in the user script, install Cloudwatch Agent so that you can collect logs and internal metrics from the instance in AWS Cloudwatch. See this [tutorial](https://aws.amazon.com/blogs/mt/simplifying-apache-server-logs-with-amazon-cloudwatch-logs-insights/).

-------
Hi I'm [Emmanuel](https://emmanuelnk.com)! I write about Software and DevOps.

If you liked this article and want to see more, add me on [LinkedIn](https://www.linkedin.com/in/emmanuel-nsubuga-kyeyune/) or follow me on [Twitter](https://twitter.com/emmanuel_n_k)