import React, { useState } from 'react';
import styled from 'styled-components/native';
import { View, TextInput, Alert, ScrollView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useData } from '../hooks/useData';
import Button from '../components/common/Button';
import Chip from '../components/common/Chip';
import { DayOfWeek, Student } from '../types';
import { v4 as uuidv4 } from 'uuid';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  padding: ${({ theme }) => theme.spacing.medium}px;
`;

const TitleText = styled.Text`
  font-size: 24px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.large}px;
  text-align: center;
`;

const Label = styled.Text`
  font-size: 16px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.small}px;
  margin-top: ${({ theme }) => theme.spacing.medium}px;
`;

const StyledTextInput = styled.TextInput`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  font-size: 16px;
`;

const ChipContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
`;

const TimePickerButton = styled.TouchableOpacity`
  background-color: ${({ theme }) => theme.colors.cardBackground};
  padding: ${({ theme }) => theme.spacing.medium}px;
  border-radius: ${({ theme }) => theme.borderRadius.medium}px;
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.border};
  align-items: center;
`;

const TimePickerText = styled.Text`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const AddStudentModal: React.FC = () => {
  const navigation = useNavigation();
  const { addStudent } = useData();

  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [selectedDays, setSelectedDays] = useState<DayOfWeek[]>([]);
  const [startTime, setStartTime] = useState(new Date());
  const [endTime, setEndTime] = useState(new Date());
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [fee, setFee] = useState('');

  const days: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const toggleDay = (day: DayOfWeek) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter((d) => d !== day));
    } else {
      setSelectedDays([...selectedDays, day]);
    }
  };

  const handleSave = async () => {
    if (!name || !grade || selectedDays.length === 0) {
      Alert.alert('Error', 'Please fill in all required fields.');
      return;
    }

    const newStudent: Student = {
      id: uuidv4(),
      name,
      grade,
      scheduledDays: selectedDays,
      scheduledStartTime: format(startTime, 'HH:mm'),
      scheduledEndTime: format(endTime, 'HH:mm'),
      fee: fee ? parseInt(fee, 10) : undefined,
    };

    try {
      await addStudent(newStudent);
      navigation.goBack();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to add student.');
    }
  };

  const onStartTimeChange = (event: any, selectedDate?: Date) => {
    const currentDate = selectedDate || startTime;
    setShowStartTimePicker(Platform.OS === 'ios');
    setStartTime(currentDate);
  };

  const onEndTimeChange = (event: any, selectedDate?: Date) => {
    const currentDate = selectedDate || endTime;
    setShowEndTimePicker(Platform.OS === 'ios');
    setEndTime(currentDate);
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Container>
        <TitleText>Add New Student</TitleText>

        <Label>Name</Label>
        <StyledTextInput value={name} onChangeText={setName} placeholder="Enter name" />

        <Label>Grade</Label>
        <StyledTextInput value={grade} onChangeText={setGrade} placeholder="Enter grade" />

        <Label>Scheduled Days</Label>
        <ChipContainer>
          {days.map((day) => (
            <Chip
              key={day}
              label={day}
              selected={selectedDays.includes(day)}
              onPress={() => toggleDay(day)}
            />
          ))}
        </ChipContainer>

        <Label>Scheduled Time</Label>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <TimePickerButton onPress={() => setShowStartTimePicker(true)}>
              <TimePickerText>{format(startTime, 'h:mm a')}</TimePickerText>
            </TimePickerButton>
            {showStartTimePicker && (
              <DateTimePicker
                value={startTime}
                mode="time"
                is24Hour={false}
                display="default"
                onChange={onStartTimeChange}
              />
            )}
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <TimePickerButton onPress={() => setShowEndTimePicker(true)}>
              <TimePickerText>{format(endTime, 'h:mm a')}</TimePickerText>
            </TimePickerButton>
            {showEndTimePicker && (
              <DateTimePicker
                value={endTime}
                mode="time"
                is24Hour={false}
                display="default"
                onChange={onEndTimeChange}
              />
            )}
          </View>
        </View>

        <Label>Monthly Fee (Optional)</Label>
        <StyledTextInput
          value={fee}
          onChangeText={setFee}
          placeholder="Enter fee"
          keyboardType="numeric"
        />

        <View style={{ marginTop: 24 }}>
          <Button title="Save Student" onPress={handleSave} />
        </View>
      </Container>
    </ScrollView>
  );
};

export default AddStudentModal;
