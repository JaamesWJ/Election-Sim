// ═══════════════════════════════════════════════════════════
// firebase-config.js
// ═══════════════════════════════════════════════════════════
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (free Spark plan is fine)
// 3. Add a Web App to the project
// 4. Copy your firebaseConfig values below
// 5. In Firebase console → Build → Firestore Database → Create database (start in test mode)
// 6. In Firebase console → Build → Firestore → Rules, paste:
//      rules_version = '2';
//      service cloud.firestore {
//        match /databases/{database}/documents {
//          match /election/{document=**} { allow read: if true; allow write: if false; }
//          match /admin/{document=**} { allow read, write: if false; }
//        }
//      }
//    (Admin writes happen via Firebase Admin SDK or you can use "test mode" while developing)
// ═══════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// 🔴 REPLACE THESE WITH YOUR OWN FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyBcEd-D1vZH2ldoDl3utcDZvhqLeWZEAuU",
    authDomain: "my-election-sim.firebaseapp.com",
    projectId: "my-election-sim",
    storageBucket: "my-election-sim.firebasestorage.app",
    messagingSenderId: "119122516085",
    appId: "1:119122516085:web:b7bb50398b108c6148003c",
    measurementId: "G-FRJL50H5W4"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
