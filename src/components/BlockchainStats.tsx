import React from 'react';
import { View, Text, useWindowDimensions, ActivityIndicator } from 'react-native';
import { useObservable } from '@legendapp/state/react';
import { blockchainStore } from '../store/blockchainStore';

type BlockchainStatsProps = {
  testID?: string;
};

export const BlockchainStats: React.FC<BlockchainStatsProps> = ({ testID }) => {
  // Use the observable store to get reactive state
  const stats = useObservable(blockchainStore.stats);
  const isLoading = useObservable(blockchainStore.isLoading);
  const { width } = useWindowDimensions();

  // Determine if we should stack vertically (for mobile screens)
  const isStackedLayout = width < 768;

  // Define the container style based on screen width
  const containerClassName = isStackedLayout
    ? "flex flex-col w-full gap-4 mb-5"
    : "flex-row justify-between w-full gap-5 mb-5";

  return (
    <View className={containerClassName} testID={testID}>
      <View className="flex-1 bg-secondary rounded-lg p-5">
        <Text className="text-white text-base font-bold mb-2.5">Block Height</Text>
        {isLoading.get() && stats.blockHeight.get() === null ? (
          <ActivityIndicator size="small" color="#E75A5C" />
        ) : (
          <Text className="text-white text-2xl font-bold">
            {stats.blockHeight.get()?.toLocaleString() || '0'}
          </Text>
        )}
      </View>

      <View className="flex-1 bg-secondary rounded-lg p-5">
        <Text className="text-white text-base font-bold mb-2.5">Current Epoch</Text>
        {isLoading.get() && stats.epoch.get() === null ? (
          <ActivityIndicator size="small" color="#E75A5C" />
        ) : (
          <Text className="text-white text-2xl font-bold">
            {stats.epoch.get()?.toLocaleString() || '0'}
          </Text>
        )}
      </View>

      <View className="flex-1 bg-secondary rounded-lg p-5">
        <Text className="text-white text-base font-bold mb-2.5">Chain ID</Text>
        {isLoading.get() && stats.chainId.get() === null ? (
          <ActivityIndicator size="small" color="#E75A5C" />
        ) : (
          <Text className="text-white text-2xl font-bold">
            {stats.chainId.get() || '0'}
          </Text>
        )}
      </View>
    </View>
  );
}; 