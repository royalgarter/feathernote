'use client';

import React, { createContext, useState, useEffect, useCallback } from 'react';
import { jwtDecode } from 'jwt-decode';

// This is a placeholder for your Google Client ID.
// You should replace this with your actual client ID and store it in a .env.local file.
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";

interface User {
  id: string;
  name: string;
  email: string;
  picture: string;
}

interface AuthContextType {
  user: User | null;
  signIn: () => void;
  signOut: () => void;
}

interface DecodedJwt {
    sub: string;
    name: string;
    email: string;
    picture: string;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isGsiLoaded, setIsGsiLoaded] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('feathernote-user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setIsGsiLoaded(true);
    document.body.appendChild(script);

    return () => {
        document.body.removeChild(script);
    }
  }, []);

  const handleCredentialResponse = useCallback((response: any) => {
    try {
      const decoded: DecodedJwt = jwtDecode(response.credential);
      const newUser: User = {
        id: decoded.sub,
        name: decoded.name,
        email: decoded.email,
        picture: decoded.picture,
      };
      setUser(newUser);
      localStorage.setItem('feathernote-user', JSON.stringify(newUser));
    } catch (error) {
      console.error("Error decoding JWT:", error)
    }
  }, []);

  const initializeGoogleOneTap = useCallback(() => {
    if (window.google && window.google.accounts) {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        use_fedcm_for_prompt: true
      });
      // The `prompt` method should be called to display the One Tap prompt
      // or to trigger the automatic sign-in flow.
      if(!user) {
        window.google.accounts.id.prompt();
      }
    } else {
        console.error("Google Identity Services script not loaded.");
    }
  }, [handleCredentialResponse, user]);

  useEffect(() => {
    if(isGsiLoaded) {
      initializeGoogleOneTap();
    }
  }, [isGsiLoaded, initializeGoogleOneTap]);


  const signIn = () => {
    if (isGsiLoaded) {
        initializeGoogleOneTap();
    }
  };

  const signOut = () => {
    setUser(null);
    localStorage.removeItem('feathernote-user');
    if (window.google && window.google.accounts) {
      window.google.accounts.id.disableAutoSelect();
    }
    // Optionally, you might want to refresh the page or redirect
    window.location.reload();
  };

  return (
    <AuthContext.Provider value={{ user, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
