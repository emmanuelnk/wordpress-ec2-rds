import * as dotenv from 'dotenv'

dotenv.config()

const stage = process.env.STAGE || 'dev'

export const config = {
  projectName: `wordpress-ec2-rds-${stage}`,
  stage,
  env: {
    account: process.env.AWS_ACCOUNT_NUMBER,
    region: process.env.AWS_REGION || 'us-west-2',
  },
  deployedBy:
    process.env.DEPLOYED_BY || process.env.USER || 'github.actions.bot',
  wordpress: {
    admin: {
      username: process.env.WP_ADMIN_USER || 'admin',
      email: process.env.WP_ADMIN_EMAIL || 'admin@whatever.com'
    },
    site: {
      databaseName: process.env.WP_DB_NAME || 'awesome_wp_site_db',
      title: process.env.WP_SITE_TITLE || 'awesome-wp-site',
      installPath: process.env.WP_SITE_INSTALL_PATH || '/var/www/html/',
    }
  }
}