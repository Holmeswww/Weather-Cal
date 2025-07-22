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

  // Gather context for Gemini
  await weatherCal.setupWeather();
  await weatherCal.setupEvents();
  await weatherCal.setupReminders();

  const context = {
    date: new Date().toString(),
    weather: weatherCal.data.weather,
    events: weatherCal.data.events.map(e => ({ title: e.title, startDate: e.startDate })),
    reminders: weatherCal.data.reminders.map(r => ({ title: r.title, dueDate: r.dueDate })),
  };

  const systemPrompt = `
    You are an intelligent assistant for a mobile widget. 
    Based on the user's context (date, weather, events), choose up to 3 relevant widget items, **ordered by importance**, and provide a concise, friendly message.
    Available items: 'date', 'greeting', 'events', 'reminders', 'current', 'future', 'forecast', 'sunrise', 'battery'.
    Your response must be ONLY the raw JSON object, without any surrounding text, explanations, or markdown formatting like \`\`\`.
    Example: {"layout": "events\\ngreeting\\ncurrent", "message": "Here's your afternoon update!"}
  `;

  const inputData = {
    query: "Choose the best widget layout based on the context.",
    context: JSON.stringify(context, null, 2),
    systemPrompt: systemPrompt,
  };

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
      layout: "greeting\ndate\ncurrent",
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
const items = geminiData.layout.split('\n').filter(item => item.trim() !== '');

// 3. Distribute items into left and right columns
const leftItems = [];
const rightItems = [];

if (items.length > 0) {
  // The first, most important item goes to the left column.
  leftItems.push(items.shift()); 
}
// The rest of the items go to the right column.
items.forEach(item => rightItems.push(item));

// 4. Build the layout strings for each column
const leftColumnString = leftItems.length > 0 ? `
    column
      ${leftItems.join('\n      ')}
` : '';

const rightColumnString = rightItems.length > 0 ? `
    column
      ${rightItems.join('\n      ')}
` : '';

// 5. Assemble the final layout with the message on top
const layout = `
  // Top row for the centered greeting message
  row
    column
      center
      text("${safeMessage}")

  // Optional space between greeting and content
  space(10)

  // Bottom row for the two-column content
  row
    ${leftColumnString}
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