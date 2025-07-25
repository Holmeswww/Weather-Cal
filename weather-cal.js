/*

~

Welcome to Weather Cal. This widget is powered by Gemini AI
to dynamically choose what to display.

~

*/

// --- Gemini Client Importer ---
const geminiImporter = FileManager.local();
const geminiCodeFilename = "GeminiAPI.js";
const pathToGeminiCode = geminiImporter.joinPath(geminiImporter.documentsDirectory(), geminiCodeFilename);

if (geminiImporter.isFileStoredIniCloud(pathToGeminiCode)) {
  await geminiImporter.downloadFileFromiCloud(pathToGeminiCode);
}
const gemini = importModule(geminiCodeFilename);


/**
 * Fetches a dynamic layout from Gemini, with a 30-minute cache.
 * @param {object} weatherCal - The imported Weather Cal module.
 * @returns {Promise<{layout: string, message: string}>}
 */
async function getGeminiLayout(weatherCal) {
  // Define cache path and check for a valid 30-minute cache
  const cachePath = weatherCal.fm.joinPath(weatherCal.fm.libraryDirectory(), "weather-cal-gemini-cache-" + Script.name());
  const cachedData = weatherCal.getCache(cachePath, 30);

  if (cachedData && !cachedData.cacheExpired && !config.runsInApp) {
    console.log("Using cached Gemini layout.");
    return cachedData;
  }

  console.log("Fetching new layout from Gemini.");

  // Initialize settings and locale before using them
  weatherCal.settings = await weatherCal.getSettings();
  weatherCal.locale = weatherCal.settings.widget.locale;
  if (!weatherCal.locale || weatherCal.locale === "" || weatherCal.locale === null) {
    weatherCal.locale = Device.locale();
  }

  // --- Gather rich context for Gemini ---
  await weatherCal.setupWeather(); // Includes location and sun data
  await weatherCal.setupEvents();
  await weatherCal.setupReminders();
  await weatherCal.setupNews();

  const context = {
    current_time: new Date().toString(),
    location: weatherCal.data.location,
    weather: weatherCal.data.weather,
    sun_times: {
      sunrise: weatherCal.data.sun.sunrise ? new Date(weatherCal.data.sun.sunrise).toString() : null,
      sunset: weatherCal.data.sun.sunset ? new Date(weatherCal.data.sun.sunset).toString() : null,
    },
    // FIX: Convert event dates to local time strings
    events: weatherCal.data.events.map(e => ({ 
      title: e.title, 
      startDate: e.startDate.toString(), 
      isAllDay: e.isAllDay 
    })),
    // FIX: Convert reminder dates to local time strings (if they exist)
    reminders: weatherCal.data.reminders.map(r => ({ 
      title: r.title,
      dueDate: r.dueDate ? r.dueDate.toString() : null,
      isOverdue: r.isOverdue 
    })),
    battery: {
        level: Math.round(Device.batteryLevel() * 100) + "%",
        isCharging: Device.isCharging()
    },
    news_headlines: weatherCal.data.news,
  };

  const systemPrompt = `
    You are an intelligent assistant for a mobile widget. Your goal is to create the most useful and relevant widget layout for the user based on their current context.

    Analyze the provided JSON context, which includes the current time, location, weather, sunrise/sunset times, calendar events, reminders, battery status, and more.

    Choose up to 4 of the most relevant widget items from the list below. The items should be ordered by importance.

    Your response must be ONLY the raw JSON object, without any surrounding text, explanations, or markdown formatting like \`\`\`.

    ## Available Widget Items:
    - 'date': The current date. Shows a large date, but becomes smaller if events are also shown.
    - 'events': A list of upcoming calendar events. A top priority if there are events soon.
    - 'reminders': A list of incomplete reminders. Important if items are overdue or due soon.
    - 'current': The current weather conditions and temperature.
    - 'future': A summary of the weather for the next hour (day) or tomorrow (night).
    - 'hourly': A multi-hour weather forecast. Good for planning an outing.
    - 'daily': A multi-day weather forecast. Good for planning ahead.
    - 'sunrise': The next sunrise or sunset time. Most relevant near those times.
    - 'battery': The current battery level and charging status. Most relevant when the battery is low.
    - 'uvi': The current UV Index. Important on sunny days.
    - 'week': The current week number of the year.
    - 'news': The latest news headline from a pre-configured RSS feed.

    ## Output Format:
    {"layout": "item1\\nitem2\\nitem3", "message": "A concise, and relevant one-liner less than 10 words."}

    ## Example:
    It's morning, there's an event (tennis) soon, and it's raining.
    {"layout": "events\\ncurrent\\nnews\\nhourly", "message": "Tennis soon. Don't forget your umbrella!"}
  `;

  const inputData = {
    query: "Choose the best widget layout and create a short message based on the context.",
    context: JSON.stringify(context, null, 2),
    systemPrompt: systemPrompt,
  };

  // Log the context data for debugging
  console.log("Gemini Context:");
  console.log(JSON.stringify(context, null, 2));

  try {
    const geminiResponse = await gemini.generate(inputData);

    // Clean the response to extract only the JSON object
    let cleanedResponse = geminiResponse;
    const jsonStartIndex = cleanedResponse.indexOf('{');
    const jsonEndIndex = cleanedResponse.lastIndexOf('}');
    
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
      cleanedResponse = cleanedResponse.substring(jsonStartIndex, jsonEndIndex + 1);
    }

    const parsedResponse = JSON.parse(cleanedResponse);
    
    console.log("Gemini Parsed Response:");
    console.log(JSON.stringify(parsedResponse, null, 2));
    
    weatherCal.fm.writeString(cachePath, JSON.stringify(parsedResponse));
    return parsedResponse;
  } catch (e) {
    console.error("Gemini API/JSON Parse error: " + e.message);
    return {
      layout: "date\ncurrent\nhourly",
      message: "Here is your daily summary.",
    };
  }
}


/*
 * Main Widget Code
 * =====================================
 */

// Names of Weather Cal elements.
const codeFilename = "Weather Cal code"
const gitHubUrl = "https://raw.githubusercontent.com/holmeswww/Weather-Cal/main/weather-cal-code.js"

// Determine if the user is using iCloud.
let files = FileManager.local()
const iCloudInUse = files.isFileStoredIniCloud(module.filename)
files = iCloudInUse ? FileManager.iCloud() : files

// Download Weather Cal code if needed.
const pathToCode = files.joinPath(files.documentsDirectory(), codeFilename + ".js")
if (!files.fileExists(pathToCode)) {
  const req = new Request(gitHubUrl)
  const codeString = await req.loadString()
  files.writeString(pathToCode, codeString)
}

// Import the code.
if (iCloudInUse) { await files.downloadFileFromiCloud(pathToCode) }
const code = importModule(codeFilename)
code.initialize(Script.name(), iCloudInUse); // Initialize Weather Cal

// Run setup if needed.
let preview;
if (config.runsInApp) {
  preview = await code.runSetup(Script.name(), iCloudInUse, codeFilename, gitHubUrl)
  if (!preview) return
}

// --- Get Dynamic Layout from Gemini ---
const geminiData = await getGeminiLayout(code);

// --- Construct the dynamic layout from Gemini's response ---

// 1. Prepare the message from Gemini
const safeMessage = geminiData.message.replace(/"/g, '\\"');

// 2. Split the layout items into an array
const items = geminiData.layout.split('\n').filter(item => item.trim() !== '' && code[item.trim()]);

// 3. Distribute items into three columns
const leftItems = [];
const middleItems = [];
const rightItems = [];

items.forEach((item, index) => {
  const mod = index % 3;
  if (mod === 0) {
    leftItems.push(item);
  } else if (mod === 1) {
    middleItems.push(item);
  } else {
    rightItems.push(item);
  }
});

// 4. Build the layout strings for each column
const leftColumnString = leftItems.length > 0 ? `
    column
      ${leftItems.join('\n      ')}
` : '';

const middleColumnString = middleItems.length > 0 ? `
    column
      ${middleItems.join('\n      ')}
` : '';

const rightColumnString = rightItems.length > 0 ? `
    column
      ${rightItems.join('\n      ')}
` : '';

// 5. Assemble the final layout with the message on top and three content columns
const layout = `
  row
    column
      center
      text(${safeMessage})

  row
    ${leftColumnString}
    ${middleColumnString}
    ${rightColumnString}
`;

// Set up the widget.
const widget = await code.createWidget(layout, Script.name(), iCloudInUse)
Script.setWidget(widget)

// If we're in app, display the preview.
if (config.runsInApp) {
  if (preview == "small") { widget.presentSmall() }
  else if (preview == "medium") { widget.presentMedium() }
  else { widget.presentLarge() }
}

Script.complete()