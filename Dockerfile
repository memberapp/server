FROM node:12.13.1
MAINTAINER Josh Ellithorpe <quest@mac.com>

# Setup app environment
ENV APP_HOME /app
ENV HOME /root

# Copy resources to APP_HOME
RUN mkdir $APP_HOME
WORKDIR $APP_HOME
COPY . $APP_HOME

# Remove anything lingering in the data dir.
RUN rm data/*

# Build the code and nuke local modules.
RUN rm -rf node_modules
RUN yarn

VOLUME /data

ENV PORT 3123
EXPOSE 3123
CMD ["node", "index.js"]
