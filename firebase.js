import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getAuth }       from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDghSMRS4HmjIQ62S1BJ_BAtfEe9292DoE",
  authDomain: "geoconquer-2.firebaseapp.com",
  projectId: "geoconquer-2",
  storageBucket: "geoconquer-2.firebasestorage.app",
  messagingSenderId: "913628890492",
  appId: "1:913628890492:web:5a07acb8c0b38d0ff750f9"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
