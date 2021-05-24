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
  public readonly loadBalancerDnsName: string
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
