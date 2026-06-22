import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDyPikK4D7pJyo3np-HafYH9LmOkv1kp2E",
  authDomain: "vsa-portal-zero-p0.firebaseapp.com",
  projectId: "vsa-portal-zero-p0",
  storageBucket: "vsa-portal-zero-p0.firebasestorage.app",
  messagingSenderId: "311864812480",
  appId: "1:311864812480:web:7760d44c4a2c740f2d1e25",
  measurementId: "G-BV9CJP9XPZ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');
