// Configuración de Firebase — proyecto "despensa-c75"
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDMaPb5_WOodXkFc8912xWv3R74Fb_OKB4",
  authDomain: "despensa-c75.firebaseapp.com",
  projectId: "despensa-c75",
  storageBucket: "despensa-c75.firebasestorage.app",
  messagingSenderId: "360091946716",
  appId: "1:360091946716:web:b703a73a4920031e836e19"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Cache local para que la app funcione offline y sincronice al recuperar conexión
try {
  enableIndexedDbPersistence(db).catch(() => {
    // Falla si hay varias pestañas abiertas a la vez; no es crítico, seguimos sin persistencia offline
  });
} catch (e) {}

export {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  orderBy,
  serverTimestamp
};
