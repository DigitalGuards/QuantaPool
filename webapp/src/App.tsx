import { BrowserRouter, Routes, Route } from 'react-router';
import { useEffect } from 'react';
import { rootStore, StoreContext } from './stores/RootStore';
import { MainLayout } from './components/layout/MainLayout';
import { Home } from './pages/Home';
import { Stake } from './pages/Stake';
import { Queue } from './pages/Queue';
import { Stats } from './pages/Stats';

function App() {
  useEffect(() => {
    // Initialize stores on mount
    rootStore.initialize();

    // Cleanup on unmount
    return () => {
      rootStore.cleanup();
    };
  }, []);

  return (
    <StoreContext.Provider value={rootStore}>
      <BrowserRouter>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/stake" element={<Stake />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/stats" element={<Stats />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreContext.Provider>
  );
}

export default App;
