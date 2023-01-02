import { App, ExpressReceiver, ReceiverEvent } from '@slack/bolt'
import { APIGatewayEvent, Context } from 'aws-lambda'
import * as dotenv from 'dotenv'
const fetch = require('node-fetch')
dotenv.config();

const expressReceiver = new ExpressReceiver({
  signingSecret: `${process.env.SLACK_SIGNING_SECRET}`,
  processBeforeResponse: true
});

const app = new App({
  signingSecret: `${process.env.SLACK_SIGNING_SECRET}`,
  token: `${process.env.SLACK_BOT_TOKEN}`,
  receiver: expressReceiver
});

// Declare functions that are needed for fetching and analysing date from CKAN API
const getJSON = async (url: string) => {
  const response = await fetch(url);
  return response.json(); // get JSON from the response 
}

function findNewest(data: { [x: string]: any; }, days: number) {
  var today = new Date()
  let newestArray: any[] = []
  for (const obj in data) {
    let date = new Date(data[obj].date_released)
    if ((new Date(today.getFullYear(), today.getMonth(), today.getDate() - days))<=date) {
      newestArray = newestArray.concat(data[obj])
    }
  }
  return newestArray;
}

function findUpdated(data: { [x: string]: any; }, days: number) {
  var today = new Date()
  let updatedArray: any[] = []
  for (const obj in data) {
    try {
      let date = new Date(data[obj].date_updated)
      if ((new Date(today.getFullYear(), today.getMonth(), today.getDate() - days))<=date) {
       updatedArray = updatedArray.concat(data[obj])
      }
    } catch (error) {
        console.log("err")
        console.error(error);
    }   
  }
  return updatedArray;
}

function generateTextResponse (newestArray: any[], updatedArray: any[], days: number) {
  let text = ""
  if (newestArray.length === 0) {
    text = text.concat("*Keine neuen Datensätze!*\nIn den letzten " + days + " Tagen wurden keine neuen Datensätze im Berliner Datenportal veröffentlicht.\n");
  }
  else {
    text = text.concat("*Neue offene Datensätze!* :star:\nIn den letzten " + days + " Tagen wurden folgende neue Datensätze im Berliner Datenportal veröffentlicht:\n")
    for (const obj in newestArray) {
      text = text.concat(">*<https://daten.berlin.de/search/node/" + newestArray[obj].title.toString().replace(/\s/g, "%20") + "|" + newestArray[obj].title.toString() + ">*\n>" + newestArray[obj].author.toString() + "\n>_" + newestArray[obj].date_released.toString() + "_\n")
    }
  }

  if (updatedArray.length === 0) {
    text = text.concat("\nIn den letzten " + days + " Tagen wurden keine der bereits veröffentlichten Datensätze im Berliner Datenportal geupdated.");
  }
  else {
    text = text.concat("\n*Datensatz-Updates!*\nIn den letzten " + days + " Tagen wurden folgende bereits veröffentlichte Datensätze geupdated:\n")
    for (const obj in updatedArray) {
      text = text.concat(">*<https://daten.berlin.de/search/node/" + updatedArray[obj].title.toString().replace(/\s/g, "%20") + "|" + updatedArray[obj].title.toString() + ">* _" + updatedArray[obj].date_updated.toString() + " (Erstveröffentlichung: " + updatedArray[obj].date_released.toString() + ")_\n")
    }
  }
  return text
}



async function replyMessage(channelId: string, messageThreadTs: string): Promise<void> {
  try {
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      thread_ts: messageThreadTs,
      text: "Hello :wave:"
    });
  } catch (error) {
    console.error(error);
  }
}

async function replyReaction(channelId: string, messageThreadTs: string) {
  try {
      await app.client.reactions.add({
          token: process.env.SLACK_BOT_TOKEN,
          name: 'robot_face',
          channel: channelId,
          timestamp: messageThreadTs,
      });
  } catch (error) {
      console.error(error);
  }
}

app.message(async ({ message }) => {
  await replyReaction(message.channel, message.ts);
  await replyMessage(message.channel, message.ts);
});

// Slash-Command to ask for newest data sets
app.command("/opendata", async ({ command, ack, say }) => {
  try {
    await ack();

    let days = Number.parseInt(command.text)
    if (!days) {
      days = 7
    }
    console.log(days)

    getJSON("https://datenregister.berlin.de/api/3/action/package_search?start=0&rows=500")
    .then(async data => {
      let resultsArray: any[] = []
      for (const id in data.result.results){
        resultsArray = resultsArray.concat(data.result.results[id]);
      }  

      const newestArray = findNewest(resultsArray, days)
      const updatedArray = findUpdated(resultsArray, days)

    const text = generateTextResponse(newestArray, updatedArray, days)

    say(text)

  });
  } catch (error) {
      console.log("err")
    console.error(error);
  }
});

function parseRequestBody(stringBody: string | null, contentType: string | undefined) {
  try {
    let inputStringBody: string = stringBody ?? "";
    let result: any = {};

    if(contentType && contentType === 'application/x-www-form-urlencoded') {
      var keyValuePairs = inputStringBody.split('&');
      keyValuePairs.forEach(function(pair: string): void {
          let individualKeyValuePair: string[] = pair.split('=');
          result[individualKeyValuePair[0]] = decodeURIComponent(individualKeyValuePair[1] || '');
      });
      return JSON.parse(JSON.stringify(result));
    } else {
      return JSON.parse(inputStringBody);
    }
  } catch {
    return undefined;
  }
}

export async function handler(event: APIGatewayEvent, context: Context) {
  const payload = parseRequestBody(event.body, event.headers["content-type"]);

  if(payload && payload.type && payload.type === 'url_verification') {
    return {
      statusCode: 200,
      body: payload.challenge
    };
  }

  const slackEvent: ReceiverEvent = {
    body: payload,
    ack: async (response) => {
      return new Promise<void>((resolve, reject) => {
        resolve();
        return {
          statusCode: 200,
          body: response ?? ""
        };
      });
    },
  };

  await app.processEvent(slackEvent);

  return {
    statusCode: 200,
    body: ""
  };
}