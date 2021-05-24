import * as cdk from '@aws-cdk/core'
import * as ec2 from '@aws-cdk/aws-ec2'
import * as rds from '@aws-cdk/aws-rds'

// this is where we will keep our database credentials e.g. user, password, host etc
import * as secrets from '@aws-cdk/aws-secretsmanager'

interface StackProps {
  // this is useful when deploying to multiple environments e.g. prod, dev
  prefix: string
  vpc: ec2.IVpc
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
  constructor(scope: cdk.Construct, props: StackProps) {
    const defaultVPC = props.vpc

    // create the security group for RDS instance
    const ingressSecurityGroup = new ec2.SecurityGroup(
      scope,
      `${props.prefix}-rds-ingress`,
      {
        vpc: defaultVPC,
        securityGroupName: `${props.prefix}-rds-ingress-sg`,
      }
    )

    ingressSecurityGroup.addIngressRule(
      // defaultVPC.vpcCidrBlock refers to all the IP addresses in defaultVPC
      ec2.Peer.ipv4(defaultVPC.vpcCidrBlock),
      ec2.Port.tcp(props.port || 3306),
      'Allows only local resources inside VPC to access this MySQL port (default -- 3306)'
    )

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

    const mysqlRDSInstance = new rds.DatabaseInstance(
      scope,
      `${props.prefix}-MySqlRDSInstance`,
      {
        credentials: rds.Credentials.fromSecret(databaseCredentialsSecret),
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_8_0_23,
        }),
        port: props.port,
        allocatedStorage: 10,
        storageType: rds.StorageType.GP2,
        backupRetention: cdk.Duration.days(3),
        // t2.micro is free tier so we use it
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T2,
          ec2.InstanceSize.MICRO
        ),
        vpc: defaultVPC,
        // we chose to place our database in an isolated subnet of our VPC
        vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
        // if we destroy our database, AWS will take a snapshot of the database instance before terminating it
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        // accidental deletion protection -- if true, you need to manually disable this in AWS web console to delete the database
        deletionProtection: false,
        securityGroups: [ingressSecurityGroup],
      }
    )
  }
}
