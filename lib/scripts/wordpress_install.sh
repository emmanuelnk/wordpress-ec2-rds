#! /bin/bash

# Author: Emmanuel N Kyeyune <emmakyeyune@gmail.com>
# Permission to copy and modify is granted under the Creative Commons Attribution 4.0 license

#----------------------------------------- 0.USEFUL FUNCTIONS

# Checks if an env is defined in the current session (not null)
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

#----------------------------------------- 1.INSTALL DEPENDECIES
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

# Install Wordpress CLI which will help us install Wordpress
curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
chmod +x wp-cli.phar
mv wp-cli.phar /usr/local/bin/wp

#----------------------------------------- 2.SET SCRIPT GLOBAL VARIABLES

# AWS and Wordpress variables to replace
DB_SECRETS_PATH=_DB_SECRETS_PATH_
WP_SECRETS_PATH=_WP_SECRETS_PATH_
AWS_REGION=_AWS_REGION_
WP_DB_NAME=_WP_DB_NAME_
WP_SITE_TITLE=_WP_SITE_TITLE_
WP_SITE_INSTALL_PATH=_WP_SITE_INSTALL_PATH_
WP_SITE_BASE_DOMAIN=_WP_SITE_BASE_DOMAIN_

# wait for Secrets Manager to have RDS secret ready
# certain database secrets (e.g host, port) won't be ready until the database is ready
echo "Waiting up to 20 minutes for Secrets Manager to be ready with Secrets";
for i in {1..40}; do
    echo "try count: $i"
    db_secrets_ready && break;
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

# For debugging: save secrets to file
# {
#     echo DB_SECRETS_PATH=$DB_SECRETS_PATH
#     echo WP_SECRETS_PATH=$WP_SECRETS_PATH
#     echo AWS_REGION=$AWS_REGION
#     echo WP_DB_NAME=$WP_DB_NAME
#     echo WP_SITE_TITLE=$WP_SITE_TITLE
#     echo WP_SITE_INSTALL_PATH=$WP_SITE_INSTALL_PATH
#     echo WP_SITE_BASE_DOMAIN=$WP_SITE_BASE_DOMAIN
#     echo DB_USER=$DB_USER
#     echo DB_PASS=$DB_PASS
#     echo DB_HOST=$DB_HOST
#     echo DB_PORT=$DB_PORT
#     echo WP_ADMIN_USER=$WP_ADMIN_USER
#     echo WP_ADMIN_PASSWORD=$WP_ADMIN_PASSWORD
#     echo WP_ADMIN_EMAIL=$WP_ADMIN_EMAIL
# } >> $HOME/GLOBAL_VARIABLES

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

#----------------------------------------- 3.CREATE WORDPRESS MYSQL DATABASE

# Wait for the database to get ready
for i in {1..60}; do
    echo "try count: $i"
    mysqladmin ping -h "$DB_HOST" -u$DB_USER -p$DB_PASS -P $DB_PORT --silent && break;
    sleep 30s
done

# Create the database.
echo "Creating the database $WP_DB_NAME..."
mysql -h $DB_HOST -u$DB_USER -p$DB_PASS -P $DB_PORT -e"CREATE DATABASE $WP_DB_NAME"

#----------------------------------------- 4.SETUP WORDPRESS INSTALLATION

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

# Wordpress should be ready now!