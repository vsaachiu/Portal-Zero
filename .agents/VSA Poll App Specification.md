# **Product Specification: VSA Poll Interactive Web Application**

## **1\. Project Overview**

VSA Poll is a real-time, interactive polling and assessment web application. It allows Administrators to create sets of questions (either Open Text or Image Click-Map coordinates) and present them live to Users.

**Key Features:**

* **Concurrent Sessions:** Multiple admins can host different interactive sessions simultaneously.  
* **Join Codes:** Users join a specific live session by entering a unique short code.  
* **Frictionless Entry:** Users can participate as guests by simply entering a Display Name, or they can optionally log in.  
* **Real-time Sync:** Admins control the flow of the presentation (Live vs. Lounge, Active Question, Polling vs. Review Mode) which syncs instantly to all connected users in that session.

**Goal:** Rebuild this application from its original Google Apps Script (GAS) architecture into a modern, real-time web stack (e.g., React \+ Node.js/Socket.io, or React \+ Firebase/Supabase).

## **2\. Target Architecture & Tech Stack (Recommendations)**

* **Frontend:** React, Vue, or Svelte.  
* **Backend/Database:** Firebase (Firestore \+ Storage), Supabase, or a custom Node.js \+ PostgreSQL \+ WebSockets stack.  
* **Real-time Synchronization:** Essential requirement. The app *must* use real-time listeners (e.g., Firestore onSnapshot, Supabase Realtime, or WebSockets) scoped to a specific sessionID for syncing the presentation state and user responses.  
* **Storage:** Cloud storage bucket (S3, Firebase Storage) for image uploads.

## **3\. Authentication & Roles**

* **Admin Authentication:** Email-based login (OAuth, Magic Links, or standard credentials).  
* **Roles:**  
  * **Admin:** Identified by their email address existing in an Admins database table/collection. Admins can access, edit, and launch any Sets created by *any* Admin.  
  * **User (Guest/Logged In):** Anyone joining a session via a Join Code. No mandatory account creation is required. They are identified by a generated session cookie/UUID and a user-provided Display Name.  
* **Role Override:** Admins must have a UI toggle/link to view the app from the "User" perspective for testing.

## **4\. Data Models (Schema)**

### **4.1. Admins**

* id (PK)  
* email (String, Unique)

### **4.2. Sets (The Templates)**

* setID (PK, UUID)  
* setName (String)  
* createdBy (String, Admin Email or ID)  
* createdAt (Timestamp)

### **4.3. Questions**

* questionID (PK, UUID)  
* setID (FK to Sets)  
* qNumber (Integer) \- Used for ordering within a set.  
* type (Integer/Enum) \- 1: Open Text, 2: Image Click Map  
* title (String)  
* question (String)  
* description (Text)  
* df1\_url (String) \- URL to the primary uploaded image (Required for Type 2).  
* df2\_url (String) \- URL to secondary/optional image.  
* answer (String/JSON) \- Target coordinates stored as \[x, y\] relative to the image size (Used for Type 2).

### **4.4. LiveSessions (Replaces Global ActiveState)**

* sessionID (PK, UUID)  
* joinCode (String, Unique alphanumeric code, e.g., "AB12CD", “Join-me\!”)  
* setID (FK to Sets) \- The set being presented.  
* hostAdminId (FK to Admins) \- The admin running this session.  
* live (Boolean/Integer: 0 or 1\) \- If 0, users see a "Waiting Lounge".  
* activeQuestionId (FK to Questions, Nullable) \- The currently displayed question.  
* interactionMode (Enum/String: 'pollingMode' or 'reviewMode') \- In pollingMode, users can submit answers. In reviewMode, answering is closed, and Results/Answers are shown.  
* createdAt (Timestamp)

### **4.5. Responses**

* id (PK)  
* sessionID (FK to LiveSessions) \- Scopes the response to a specific run of a set.  
* questionID (FK to Questions)  
* userID (String/UUID) \- A unique persistent identifier generated for the user's device/browser session.  
* displayName (String) \- The name the user entered when joining.  
* answer (String/Text) \- For Type 1: Text string. For Type 2: stringified array \[x,y\].  
* timestamp (Timestamp)  
* *Rule:* A user (userID) can only have ONE response per questionID within a specific sessionID. Submitting a new answer overwrites their previous record.

## **5\. Admin Dashboard Features & Workflows**

### **5.1. Set Management & Session Launch**

* Dropdown or List to select an existing Set.  
* Input field to create a new Set name and save it.  
* Selecting a Set reveals two main actions: **Edit Questions** or **Launch Live Session**.  
* **Launch Live Session:** Creates a new record in LiveSessions, generates a random joinCode, sets live: 0, and redirects the Admin to the Presentation Dashboard. Allow Admin to change set the joinCode in the dashboard, but check it is unique across LiveSessions. 

### **5.2. Question Management (CRUD)**

* **List View:** Display all questions for the selected set in a table, ordered by qNumber.  
* **Actions:** Edit, Delete, Move Up/Down (swaps qNumber).  
* **Question Form:**  
  * Fields: Type Select, Title, Description, Question text.  
  * *Type 2 Specifics:* File Upload for df1 and df2. Clicking the df1 preview records the \[x, y\] target coordinates.

### **5.3. Live Presentation Dashboard**

* **Header:** Prominently display the **Join Code** (e.g., "Join at vsapoll.com with code: **XY98Z**").  
* **Next/Prev Buttons:** Cycles through questions based on qNumber order. Updates the LiveSessions.activeQuestionId.  
  * *Crucial Logic:* Changing the question MUST auto-set LiveSessions.interactionMode to 'pollingMode'.  
* **Toggle Live/Lounge:** Updates LiveSessions.live.  
* **Toggle Interaction Mode:** Updates LiveSessions.interactionMode (switches between pollingMode and reviewMode).

## **6\. User Interface Features & Workflows**

### **6.1. Landing / Join Screen**

* **Inputs:**  
  1. Join Code (6-character string).  
  2. Display Name (Text input for guests).  
* **Action:** Submitting validates the Join Code against active LiveSessions. If valid, generate a local userID (store in local storage/cookie), save the displayName, and route the user to the Session View.

### **6.2. Session View: Lounge State (live \=== 0\)**

* Listen to the LiveSessions document.  
* Display a waiting screen: "Connected to \[Set Name\]. Please wait for the host to start the session."

### **6.3. Session View: Polling Mode (live \=== 1 AND interactionMode \=== 'pollingMode')**

* Display title, question, and description of the activeQuestionId.  
* **Type 1 (Text):** Show Textarea and Submit button. Pre-fill if the user (userID) already answered.  
* **Type 2 (Image Map):**  
  * Display the image (df1\_url).  
  * Clicking grabs relative \[x, y\] coordinates, draws a visual marker (📍), and auto-submits.  
  * Draw the marker on load if the user already answered.

### **6.4. Session View: Review Mode (live \=== 1 AND interactionMode \=== 'reviewMode')**

* Display question info and a "Review Phase" indicator. Hide answering inputs.  
* Fetch all responses tied to the current sessionID and questionID.  
* **Type 1 Results:**  
  * Render a **Word Cloud** (filtering out words \< 3 chars).  
  * Render a list below showing exact text responses and the associated displayNames.  
* **Type 2 Results:**  
  * Display the main image.  
  * Draw the Target/Correct Answer marker (Green).  
  * Draw User Response markers (Blue) based on submitted \[x, y\] coordinates.  
  * **Distance Algorithm:** Math.sqrt(Math.pow(x2 \- x1, 2\) \+ Math.pow(y2 \- y1, 2)).  
  * **Leaderboard:** Display a "Top 20" table ranked by closest distance. Show Rank, displayName, and Distance (px).

## **7\. AI Developer Instructions**

1. **Session-Scoped Real-time Sync:** Ensure listeners (WebSockets/Firestore Snapshots) are filtered by sessionID. When an Admin updates their specific session, only users connected to that joinCode should receive the UI updates.  
2. **Anonymous Identification:** Implement a robust way to track guests. Generate a UUID upon joining and store it in localStorage or as a persistent cookie so that if they refresh the page, they can still update their existing answers instead of creating duplicates.  
3. **Image Handling:** Implement a standard file upload workflow utilizing proper Cloud Storage buckets (e.g., Firebase Storage, AWS S3). Return the resulting public URL and save that to the database.  
4. **Coordinate Consistency:** CSS properties of images must maintain the same aspect ratio and sizing (e.g., max-width: 100%) across Admin setup, User answering, and Results viewing. clientX/Y vs getBoundingClientRect() math must be identical everywhere.  
5. **Data Fetching Limits:** In Review Mode, ensure queries fetch only the responses for the *active question* in the *current session* to prevent data leakage and ensure optimal performance.